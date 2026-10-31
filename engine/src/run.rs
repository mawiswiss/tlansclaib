use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use anyhow::{Result, anyhow};
use clap::Parser;

use crate::protocol::{Event, Heard, LoadPart, Step, Timings};
use crate::speakers::{self, nemotron, sherpa};
use crate::{audio, model_file, output, transcribe, windows, words};

#[derive(Parser, Debug)]
pub struct TranscribeArgs {
    /// A whisper.cpp model file (ggml-*.bin)
    #[arg(long)]
    pub model: PathBuf,
    /// Any audio file: m4a, mp3, wav, mp4, flac, ...
    #[arg(long)]
    pub audio: PathBuf,
    /// The text file to write, one line per stretch of speech
    #[arg(long)]
    pub output: PathBuf,
    /// Leave out the time stamps in front of each line
    #[arg(long)]
    pub no_timestamps: bool,
    /// Language code such as th or en, or auto
    #[arg(long, default_value = "auto")]
    pub language: String,
    /// Number of threads, default: every physical core up to 4, otherwise one less
    #[arg(long)]
    pub threads: Option<usize>,
    /// Run on the CPU even when a GPU is available
    #[arg(long)]
    pub cpu: bool,
    /// Line length in seconds as MIN-MAX: a line ends at the first pause after MIN, at the latest at MAX. Default 5-23, or 5-15 for Thai, Chinese, Japanese and other dense scripts
    #[arg(long, value_parser = parse_window)]
    pub window: Option<(f32, f32)>,
    /// Name each line's speaker in a recording with one audio track: auto, or the number of people
    #[arg(long, value_parser = parse_speakers, requires = "speaker_models")]
    pub speakers: Option<SpeakerCount>,
    /// Folder with the speaker detection files of --speaker-backend
    #[arg(long)]
    pub speaker_models: Option<PathBuf>,
    /// sherpa: pyannote and CAM++ through sherpa-onnx. nemotron: Nemotron 3 Diarization through parakeet.cpp, at most 8 people
    #[arg(long, default_value = "sherpa")]
    pub speaker_backend: speakers::Backend,
    /// sherpa only: standard, or fast for about a third of the time with somewhat rougher speaker changes
    #[arg(long, default_value = "standard", value_parser = ["standard", "fast"])]
    pub speaker_precision: String,
    /// Beams to keep while decoding, 1 is greedy and fastest
    #[arg(long, default_value_t = transcribe::Decoding::default().beam_size)]
    pub beam_size: usize,
    /// Temperature step of the retry when a window decodes badly, 0 disables retries
    #[arg(long, default_value_t = transcribe::Decoding::default().temperature_inc)]
    pub temperature_inc: f32,
    /// A window whose token entropy is below this is retried (loop detection)
    #[arg(long, default_value_t = transcribe::Decoding::default().entropy_thold)]
    pub entropy_thold: f32,
    /// A window whose average log probability is below this is retried
    #[arg(long, default_value_t = transcribe::Decoding::default().logprob_thold)]
    pub logprob_thold: f32,
    /// Encode only as much of the 30 s input as each line needs. Faster, mostly on the CPU
    #[arg(long)]
    pub fit_encoder: bool,
}

impl TranscribeArgs {
    /// Reads the arguments of the `transcribe` command, the command's own name first.
    pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<TranscribeArgs> {
        Ok(TranscribeArgs::try_parse_from(args)?)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SpeakerCount(Option<usize>);

fn parse_speakers(text: &str) -> Result<SpeakerCount, String> {
    if text == "auto" {
        return Ok(SpeakerCount(None));
    }
    match text.parse::<usize>() {
        Ok(n) if (2..=20).contains(&n) => Ok(SpeakerCount(Some(n))),
        _ => Err("expected auto or a number of people from 2 to 20".into()),
    }
}

pub fn parse_window(text: &str) -> Result<(f32, f32), String> {
    let (min, max) = text
        .split_once('-')
        .ok_or("expected MIN-MAX, for example 17-23")?;
    let (min, max): (f32, f32) = (
        min.trim().parse().map_err(|_| "MIN is not a number")?,
        max.trim().parse().map_err(|_| "MAX is not a number")?,
    );
    if !(1.0..30.0).contains(&min) || !(min..=30.0).contains(&max) {
        return Err("windows must be between 1 and 30 seconds, with MIN below MAX".into());
    }
    Ok((min, max))
}

struct SpeakerSetup<'a> {
    count: SpeakerCount,
    backend: speakers::Backend,
    folder: &'a Path,
    window_shift: f32,
}

/// Transcribes as the arguments say, reports every step through `emit`, and ends early once `stop` is set.
/// A failure is also emitted as an error event.
pub fn transcribe(args: &TranscribeArgs, emit: &mut dyn FnMut(&Event), stop: &Arc<AtomicBool>) -> Result<()> {
    let result = run(
        &args.model,
        &args.audio,
        &args.output,
        !args.no_timestamps,
        &args.language,
        args.threads.unwrap_or_else(transcribe::default_threads),
        !args.cpu,
        args.window,
        args.speakers.zip(args.speaker_models.as_deref()).map(|(count, folder)| SpeakerSetup {
            count,
            backend: args.speaker_backend,
            folder,
            window_shift: if args.speaker_precision == "fast" { sherpa::FAST_WINDOW_SHIFT } else { sherpa::WINDOW_SHIFT },
        }),
        transcribe::Decoding {
            beam_size: args.beam_size,
            temperature_inc: args.temperature_inc,
            entropy_thold: args.entropy_thold,
            logprob_thold: args.logprob_thold,
            fit_encoder: args.fit_encoder,
        },
        emit,
        stop,
    );
    if let Err(error) = &result {
        emit(&Event::Error {
            message: format!("{error:#}"),
        });
    }
    result
}

fn running(stop: &AtomicBool) -> Result<()> {
    if stop.load(Ordering::Relaxed) { Err(anyhow!("the transcription was stopped")) } else { Ok(()) }
}

#[allow(clippy::too_many_arguments)]
fn run(
    model: &Path,
    audio_path: &Path,
    output: &Path,
    timestamps: bool,
    language: &str,
    threads: usize,
    use_gpu: bool,
    window: Option<(f32, f32)>,
    detection: Option<SpeakerSetup>,
    decoding: transcribe::Decoding,
    emit: &mut dyn FnMut(&Event),
    stop: &Arc<AtomicBool>,
) -> Result<()> {
    let started = Instant::now();
    let mut timings = Timings::default();
    if !audio_path.is_file() {
        return Err(anyhow!("{} not found", audio_path.display()));
    }
    model_file::inspect(model).map_err(|e| anyhow!("{} is {e}", model.display()))?;

    emit(&Event::Step { step: Step::Decode });
    let phase = Instant::now();
    let audio::Source { tracks, video, warnings } = audio::load_tracks(audio_path)?;
    timings.decode = phase.elapsed().as_secs_f64();
    if !warnings.is_empty() {
        emit(&Event::Warning { message: format!("The transcript leaves out audio that could not be read: {}.", warnings.join("; ")) });
    }
    let mut speakers = output::speakers(tracks.len());
    emit(&Event::Audio {
        seconds: tracks.iter().map(Vec::len).max().unwrap_or(0) as f64 / crate::RATE as f64,
        speakers: speakers.clone(),
        video,
    });
    running(stop)?;

    let turns = match detection {
        Some(_) if tracks.len() > 1 => {
            log::info!("{} audio tracks name the speakers, so speaker detection is skipped", tracks.len());
            None
        }
        Some(SpeakerSetup { count: SpeakerCount(count), backend, folder, window_shift }) => {
            emit(&Event::Step { step: Step::Speakers });
            let phase = Instant::now();
            let detection = match backend {
                speakers::Backend::Sherpa => speakers::Detection::Sherpa(sherpa::Detection {
                    folder,
                    speakers: count,
                    threshold: sherpa::DEFAULT_THRESHOLD,
                    threads,
                    window_shift,
                    min_on: sherpa::MIN_ON,
                    min_off: sherpa::MIN_OFF,
                }),
                speakers::Backend::Nemotron if count.is_some_and(|n| n > nemotron::MAX_SPEAKERS) => {
                    return Err(anyhow!("Nemotron speaker detection names at most {} people", nemotron::MAX_SPEAKERS));
                }
                speakers::Backend::Nemotron => speakers::Detection::Nemotron(nemotron::Detection { folder, speakers: count }),
            };
            let mut reported = usize::MAX;
            let turns = speakers::detect(&tracks[0], &detection, |done, total| {
                let percent = done * 100 / total.max(1);
                if percent != reported {
                    reported = percent;
                    emit(&Event::SpeakerProgress { done, total });
                }
            })?;
            timings.speakers = phase.elapsed().as_secs_f64();
            running(stop)?;
            Some(turns)
        }
        None => None,
    };

    emit(&Event::Step { step: Step::Load });
    let phase = Instant::now();
    let mut engine = transcribe::Engine::load(model, threads, use_gpu)?;
    emit(&Event::Loading { part: LoadPart::Device });
    engine.decoding = decoding;
    engine.stop = Some(stop.clone());
    let mut state = engine.state()?;
    running(stop)?;
    let (language, heard) = if !engine.is_multilingual() {
        ("en".to_string(), Vec::new())
    } else {
        let probe = windows::split_tracks(&tracks, windows::PROBE_MIN_SECONDS, windows::PROBE_MAX_SECONDS);
        if language == "auto" {
            let heard = detect(&engine, &mut state, &tracks, &probe, emit)?;
            (heard.first().map_or_else(|| "en".to_string(), |h| h.code.clone()), heard)
        } else {
            let heard = detect(&engine, &mut state, &tracks, &probe, emit).unwrap_or_else(|error| {
                log::warn!("could not detect the spoken language: {error:#}");
                Vec::new()
            });
            (language.to_string(), heard)
        }
    };
    let (min_window, max_window) = window.unwrap_or_else(|| windows::bounds_for(&language));
    let segments: Vec<(usize, Option<usize>, windows::Window)> = match &turns {
        Some(turns) => {
            let lines: Vec<windows::Window> = windows::split_tracks(&tracks, min_window, max_window).into_iter().map(|(_, w)| w).collect();
            let attributed = speakers::attribute(&lines, turns);
            speakers = output::speakers(attributed.iter().map(|(_, s)| s + 1).max().unwrap_or(0));
            emit(&Event::Speakers { speakers: speakers.clone() });
            attributed.into_iter().map(|(w, s)| (0, (!speakers.is_empty()).then_some(s), w)).collect()
        }
        None => windows::split_tracks(&tracks, min_window, max_window)
            .into_iter()
            .map(|(track, w)| (track, (!speakers.is_empty()).then_some(track), w))
            .collect(),
    };
    emit(&Event::Model {
        device: engine.device.to_string(),
        device_name: engine.device_name.clone(),
        threads,
        language: language.clone(),
        windows: segments.len(),
        heard,
    });
    timings.load = phase.elapsed().as_secs_f64();

    emit(&Event::Step { step: Step::Transcribe });
    let mut writer = output::Writer::create(output, timestamps)?;
    let mut position = 0.0f64;
    for (done, (track, speaker, window)) in segments.iter().enumerate() {
        running(stop)?;
        let phase = Instant::now();
        let decoded = engine.transcribe(&mut state, &tracks[*track][window.start..window.end], &language);
        running(stop)?;
        let decoded = decoded?;
        let text = decoded.text;
        timings.transcribe += phase.elapsed().as_secs_f64();
        emit(&Event::Line {
            start: window.start_seconds(),
            end: window.end_seconds(),
            text: text.clone(),
            speaker: *speaker,
            words: words::group(&decoded.tokens, window.start_seconds(), window.end_seconds()),
        });
        let phase = Instant::now();
        writer.append(window, speaker.and_then(|s| speakers.get(s)).map(String::as_str), &text)?;
        timings.write += phase.elapsed().as_secs_f64();
        position = position.max(window.end_seconds());
        emit(&Event::Progress {
            done: done + 1,
            total: segments.len(),
            position,
        });
    }

    emit(&Event::Step { step: Step::Write });
    let phase = Instant::now();
    let (lines, file) = writer.finish()?;
    timings.write += phase.elapsed().as_secs_f64();
    emit(&Event::Done {
        lines,
        elapsed: started.elapsed().as_secs_f64(),
        file,
        timings,
    });
    Ok(())
}

fn detect(
    engine: &transcribe::Engine,
    state: &mut whisper_rs::WhisperState,
    tracks: &[Vec<f32>],
    segments: &[(usize, windows::Window)],
    emit: &mut dyn FnMut(&Event),
) -> Result<Vec<Heard>> {
    let mut probes = Vec::new();
    for (track, window) in segments.iter().take(3) {
        emit(&Event::Loading { part: LoadPart::Language });
        probes.push(engine.language_probabilities(state, &tracks[*track][window.start..window.end])?);
    }
    Ok(transcribe::rank_languages(&probes, 3)
        .into_iter()
        .map(|(code, probability)| Heard { code, probability })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_passes_the_same_arguments_as_on_the_command_line() {
        let args = TranscribeArgs::try_parse_from(["transcribe", "--model", "m.bin", "--audio", "a.m4a", "--output", "o.txt", "--language", "de", "--no-timestamps", "--cpu", "--fit-encoder"]).unwrap();
        assert_eq!(args.language, "de");
        assert!(args.no_timestamps && args.cpu && args.fit_encoder);
        assert!(args.speakers.is_none());
        assert!(TranscribeArgs::try_parse_from(["transcribe", "--model", "m.bin", "--audio", "a.m4a", "--output", "o.txt", "--speakers", "auto"]).is_err());
    }

    #[test]
    fn a_set_stop_flag_ends_the_run() {
        let stop = Arc::new(AtomicBool::new(true));
        assert!(running(&stop).is_err());
        stop.store(false, Ordering::Relaxed);
        assert!(running(&stop).is_ok());
    }
}
