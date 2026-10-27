use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Result, anyhow};
use clap::{Parser, Subcommand};
use engine::protocol::{Event, Heard, LoadPart, Step, Timings, emit};
use engine::speakers::{nemotron, sherpa};
use engine::{audio, model_file, output, speakers, transcribe, windows, words};
use serde_json::json;

#[derive(Parser)]
#[command(name = "tlansclaib-engine", about = "Transcribes an audio file with whisper.cpp")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Transcribe an audio file and print progress as JSON lines
    Transcribe {
        /// A whisper.cpp model file (ggml-*.bin)
        #[arg(long)]
        model: PathBuf,
        /// Any audio file: m4a, mp3, wav, mp4, flac, ...
        #[arg(long)]
        audio: PathBuf,
        /// The text file to write, one line per stretch of speech
        #[arg(long)]
        output: PathBuf,
        /// Leave out the time stamps in front of each line
        #[arg(long)]
        no_timestamps: bool,
        /// Language code such as th or en, or auto
        #[arg(long, default_value = "auto")]
        language: String,
        /// Number of threads, default: every physical core up to 4, otherwise one less
        #[arg(long)]
        threads: Option<usize>,
        /// Run on the CPU even when a GPU is available
        #[arg(long)]
        cpu: bool,
        /// Line length in seconds as MIN-MAX: a line ends at the first pause after MIN, at the latest at MAX. Default 5-23, or 5-15 for Thai, Chinese, Japanese and other dense scripts
        #[arg(long, value_parser = parse_window)]
        window: Option<(f32, f32)>,
        /// Name each line's speaker in a recording with one audio track: auto, or the number of people
        #[arg(long, value_parser = parse_speakers, requires = "speaker_models")]
        speakers: Option<SpeakerCount>,
        /// Folder with the speaker detection files of --speaker-backend
        #[arg(long)]
        speaker_models: Option<PathBuf>,
        /// sherpa: pyannote and CAM++ through sherpa-onnx. nemotron: Nemotron 3 Diarization through parakeet.cpp, at most 8 people
        #[arg(long, default_value = "sherpa")]
        speaker_backend: speakers::Backend,
        /// sherpa only: standard, or fast for about a third of the time with somewhat rougher speaker changes
        #[arg(long, default_value = "standard", value_parser = ["standard", "fast"])]
        speaker_precision: String,
        /// Beams to keep while decoding, 1 is greedy and fastest
        #[arg(long, default_value_t = transcribe::Decoding::default().beam_size)]
        beam_size: usize,
        /// Temperature step of the retry when a window decodes badly, 0 disables retries
        #[arg(long, default_value_t = transcribe::Decoding::default().temperature_inc)]
        temperature_inc: f32,
        /// A window whose token entropy is below this is retried (loop detection)
        #[arg(long, default_value_t = transcribe::Decoding::default().entropy_thold)]
        entropy_thold: f32,
        /// A window whose average log probability is below this is retried
        #[arg(long, default_value_t = transcribe::Decoding::default().logprob_thold)]
        logprob_thold: f32,
        /// Encode only as much of the 30 s input as each line needs. Faster, mostly on the CPU
        #[arg(long)]
        fit_encoder: bool,
    },
    /// Check whether a file is a whisper.cpp model and print what it is
    Check { file: PathBuf },
    /// Decode an audio file to raw 16 kHz mono float samples, for checking the decoder
    Decode { audio: PathBuf, output: PathBuf },
    /// Estimate the decoded audio size without loading its samples
    AudioInfo {
        #[arg(long)]
        audio: PathBuf,
    },
    /// Print the languages whisper supports as JSON
    Languages,
    /// Start the GPU whisper.cpp would use and print it as JSON, or null when there is none
    Probe,
    /// Print who speaks when, using the speaker detection files in a folder
    Speakers {
        audio: PathBuf,
        /// Folder with lib/ and the backend's model files
        #[arg(long)]
        models: PathBuf,
        /// sherpa or nemotron
        #[arg(long, default_value = "sherpa")]
        backend: speakers::Backend,
        /// Number of speakers, a maximum for nemotron, or leave out to detect it
        #[arg(long)]
        speakers: Option<usize>,
        /// sherpa only: distance below which two voices count as one, when the number is not given
        #[arg(long, default_value_t = sherpa::DEFAULT_THRESHOLD)]
        threshold: f32,
        /// sherpa only: number of threads, default: every physical core up to 4, otherwise one less
        #[arg(long)]
        threads: Option<usize>,
        /// sherpa only: step of the 10 s analysis window as a share of it
        #[arg(long, default_value_t = sherpa::WINDOW_SHIFT)]
        shift: f32,
        /// sherpa only: shortest speech in seconds a turn keeps
        #[arg(long, default_value_t = sherpa::MIN_ON)]
        min_on: f32,
        /// sherpa only: shortest gap in seconds between two turns of one speaker
        #[arg(long, default_value_t = sherpa::MIN_OFF)]
        min_off: f32,
    },
    /// Load a speaker detection's library and print whether it works on this computer, as JSON
    SpeakersCheck {
        /// Folder with lib/ and the backend's model files
        #[arg(long)]
        models: PathBuf,
        /// sherpa or nemotron
        #[arg(long)]
        backend: speakers::Backend,
    },
    /// Print how a recording would be cut into lines, and why each line ends
    Split {
        audio: PathBuf,
        /// Language code, which sets the line length unless --window is given
        #[arg(long, default_value = "en")]
        language: String,
        /// Line length in seconds as MIN-MAX
        #[arg(long, value_parser = parse_window)]
        window: Option<(f32, f32)>,
    },
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    whisper_rs::install_logging_hooks();
    std::panic::set_hook(Box::new(|info| {
        emit(&Event::Error {
            message: format!("the engine crashed: {info}"),
        });
    }));

    let cli = Cli::parse();
    let result = match cli.command {
        Command::Transcribe {
            model,
            audio,
            output,
            no_timestamps,
            language,
            threads,
            cpu,
            window,
            speakers,
            speaker_models,
            speaker_backend,
            speaker_precision,
            beam_size,
            temperature_inc,
            entropy_thold,
            logprob_thold,
            fit_encoder,
        } => {
            lower_priority();
            let result = run(
                &model,
                &audio,
                &output,
                !no_timestamps,
                &language,
                threads.unwrap_or_else(transcribe::default_threads),
                !cpu,
                window,
                speakers.zip(speaker_models.as_deref()).map(|(count, folder)| SpeakerSetup {
                    count,
                    backend: speaker_backend,
                    folder,
                    window_shift: if speaker_precision == "fast" { sherpa::FAST_WINDOW_SHIFT } else { sherpa::WINDOW_SHIFT },
                }),
                transcribe::Decoding {
                    beam_size,
                    temperature_inc,
                    entropy_thold,
                    logprob_thold,
                    fit_encoder,
                },
            );
            if let Err(error) = &result {
                emit(&Event::Error {
                    message: format!("{error:#}"),
                });
            }
            result
        }
        Command::Check { file } => check(&file),
        Command::Probe => {
            println!("{}", json!(transcribe::gpu()));
            Ok(())
        }
        Command::Decode { audio, output } => audio::load(&audio).and_then(|samples| {
            let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
            std::fs::write(&output, bytes)?;
            println!("{} samples", samples.len());
            Ok(())
        }),
        Command::AudioInfo { audio } => audio::sample_seconds(&audio).map(|sample_seconds| {
            println!("{}", json!({ "sample_seconds": sample_seconds }));
        }),
        Command::Speakers { audio, models, backend, speakers: count, threshold, threads, shift, min_on, min_off } => audio::load(&audio).and_then(|samples| {
            let started = Instant::now();
            let detection = match backend {
                speakers::Backend::Sherpa => speakers::Detection::Sherpa(sherpa::Detection {
                    folder: &models,
                    speakers: count,
                    threshold,
                    threads: threads.unwrap_or_else(transcribe::default_threads),
                    window_shift: shift,
                    min_on,
                    min_off,
                }),
                speakers::Backend::Nemotron => speakers::Detection::Nemotron(nemotron::Detection { folder: &models, speakers: count }),
            };
            let turns = speakers::detect(&samples, &detection, |_, _| {})?;
            for t in &turns {
                println!("{}", json!({ "start": t.start, "end": t.end, "speaker": t.speaker }));
            }
            let found = turns.iter().map(|t| t.speaker + 1).max().unwrap_or(0);
            println!(
                "{}",
                json!({ "turns": turns.len(), "speakers": found, "seconds": samples.len() as f64 / engine::RATE as f64, "elapsed": started.elapsed().as_secs_f64() })
            );
            Ok(())
        }),
        Command::SpeakersCheck { models, backend } => {
            let result = speakers::check(backend, &models);
            println!("{}", json!({ "ok": result.is_ok(), "reason": result.as_ref().err().map(|error| format!("{error:#}")) }));
            result
        }
        Command::Split { audio, language, window } => audio::load_tracks(&audio).map(|source| {
            let tracks = source.tracks;
            let (min, max) = window.unwrap_or_else(|| windows::bounds_for(&language));
            let mut explained: Vec<(usize, windows::Window, windows::Cut)> = tracks
                .iter()
                .enumerate()
                .flat_map(|(track, samples)| {
                    windows::split_explained(samples, min, max).into_iter().map(move |(w, cut)| (track, w, cut))
                })
                .collect();
            explained.sort_by_key(|(track, w, _)| (w.start, *track));
            for (track, w, cut) in &explained {
                println!("{}", json!({ "track": track, "start": w.start_seconds(), "end": w.end_seconds(), "cut": cut }));
            }
            let count = |c: windows::Cut| explained.iter().filter(|(_, _, cut)| *cut == c).count();
            println!(
                "{}",
                json!({
                    "tracks": tracks.len(),
                    "lines": explained.len(),
                    "pause": count(windows::Cut::Pause),
                    "breath": count(windows::Cut::Breath),
                    "forced": count(windows::Cut::Forced),
                })
            );
        }),
        Command::Languages => {
            let list: Vec<_> = transcribe::languages()
                .into_iter()
                .map(|(code, name)| json!({ "code": code, "name": name }))
                .collect();
            println!("{}", serde_json::to_string(&list).unwrap());
            Ok(())
        }
    };
    if result.is_err() {
        std::process::exit(1);
    }
}

#[derive(Clone, Copy, Debug)]
struct SpeakerCount(Option<usize>);

fn parse_speakers(text: &str) -> Result<SpeakerCount, String> {
    if text == "auto" {
        return Ok(SpeakerCount(None));
    }
    match text.parse::<usize>() {
        Ok(n) if (2..=20).contains(&n) => Ok(SpeakerCount(Some(n))),
        _ => Err("expected auto or a number of people from 2 to 20".into()),
    }
}

struct SpeakerSetup<'a> {
    count: SpeakerCount,
    backend: speakers::Backend,
    folder: &'a Path,
    window_shift: f32,
}

fn parse_window(text: &str) -> Result<(f32, f32), String> {
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
        seconds: tracks.iter().map(Vec::len).max().unwrap_or(0) as f64 / engine::RATE as f64,
        speakers: speakers.clone(),
        video,
    });

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
            Some(turns)
        }
        None => None,
    };

    emit(&Event::Step { step: Step::Load });
    let phase = Instant::now();
    let mut engine = transcribe::Engine::load(model, threads, use_gpu)?;
    emit(&Event::Loading { part: LoadPart::Device });
    engine.decoding = decoding;
    let mut state = engine.state()?;
    let (language, heard) = if !engine.is_multilingual() {
        ("en".to_string(), Vec::new())
    } else {
        let probe = windows::split_tracks(&tracks, windows::PROBE_MIN_SECONDS, windows::PROBE_MAX_SECONDS);
        if language == "auto" {
            let heard = detect(&engine, &mut state, &tracks, &probe)?;
            (heard.first().map_or_else(|| "en".to_string(), |h| h.code.clone()), heard)
        } else {
            let heard = detect(&engine, &mut state, &tracks, &probe).unwrap_or_else(|error| {
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
        let phase = Instant::now();
        let decoded = engine.transcribe(&mut state, &tracks[*track][window.start..window.end], &language)?;
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

fn check(file: &Path) -> Result<()> {
    match model_file::inspect(file) {
        Ok(info) => {
            println!(
                "{}",
                json!({
                    "ok": true,
                    "label": info.label(),
                    "architecture": info.architecture,
                    "quantization": info.quantization,
                    "multilingual": info.multilingual,
                })
            );
            Ok(())
        }
        Err(error) => {
            println!("{}", json!({ "ok": false, "reason": error.to_string() }));
            Err(error)
        }
    }
}

fn lower_priority() {
    #[cfg(unix)]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS as _, 0, 10);
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Threading::{
            BELOW_NORMAL_PRIORITY_CLASS, GetCurrentProcess, SetPriorityClass,
        };
        SetPriorityClass(GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS);
    }
}
