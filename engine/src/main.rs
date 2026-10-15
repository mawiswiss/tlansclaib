use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Result, anyhow};
use clap::{Parser, Subcommand};
use engine::protocol::{Event, Step, emit};
use engine::{audio, model_file, output, transcribe, windows};
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
        /// Number of threads, default: physical cores minus one
        #[arg(long)]
        threads: Option<usize>,
        /// Run on the CPU even when a GPU is available
        #[arg(long)]
        cpu: bool,
        /// Line length in seconds as MIN-MAX: a line ends at the first pause after MIN, at the latest at MAX. Default 5-23, or 5-15 for Thai, Chinese, Japanese and other dense scripts
        #[arg(long, value_parser = parse_window)]
        window: Option<(f32, f32)>,
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
    },
    /// Check whether a file is a whisper.cpp model and print what it is
    Check { file: PathBuf },
    /// Decode an audio file to raw 16 kHz mono float samples, for checking the decoder
    Decode { audio: PathBuf, output: PathBuf },
    /// Print the languages whisper supports as JSON
    Languages,
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
            beam_size,
            temperature_inc,
            entropy_thold,
            logprob_thold,
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
                transcribe::Decoding {
                    beam_size,
                    temperature_inc,
                    entropy_thold,
                    logprob_thold,
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
        Command::Decode { audio, output } => audio::load(&audio).and_then(|samples| {
            let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
            std::fs::write(&output, bytes)?;
            println!("{} samples", samples.len());
            Ok(())
        }),
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
    decoding: transcribe::Decoding,
) -> Result<()> {
    let started = Instant::now();
    if !audio_path.is_file() {
        return Err(anyhow!("{} not found", audio_path.display()));
    }
    model_file::inspect(model).map_err(|e| anyhow!("{} is {e}", model.display()))?;

    emit(&Event::Step { step: Step::Decode });
    let audio::Source { tracks, video } = audio::load_tracks(audio_path)?;
    let speakers = output::speakers(tracks.len());
    emit(&Event::Audio {
        seconds: tracks.iter().map(Vec::len).max().unwrap_or(0) as f64 / engine::RATE as f64,
        speakers: speakers.clone(),
        video,
    });

    emit(&Event::Step { step: Step::Load });
    let mut engine = transcribe::Engine::load(model, threads, use_gpu)?;
    engine.decoding = decoding;
    let mut state = engine.state()?;
    let language = if !engine.is_multilingual() {
        "en".to_string()
    } else if language == "auto" {
        let probe = windows::split_tracks(&tracks, windows::PROBE_MIN_SECONDS, windows::PROBE_MAX_SECONDS);
        detect(&engine, &mut state, &tracks, &probe)?
    } else {
        language.to_string()
    };
    let (min_window, max_window) = window.unwrap_or_else(|| windows::bounds_for(&language));
    let segments: Vec<(usize, Option<usize>, windows::Window)> = windows::split_tracks(&tracks, min_window, max_window)
        .into_iter()
        .map(|(track, w)| (track, (!speakers.is_empty()).then_some(track), w))
        .collect();
    emit(&Event::Model {
        device: engine.device.to_string(),
        threads,
        language: language.clone(),
        windows: segments.len(),
    });

    emit(&Event::Step {
        step: Step::Transcribe,
    });
    let mut writer = output::Writer::create(output, timestamps)?;
    let mut position = 0.0f64;
    for (done, (track, speaker, window)) in segments.iter().enumerate() {
        let text = engine.transcribe(&mut state, &tracks[*track][window.start..window.end], &language)?;
        emit(&Event::Line {
            start: window.start_seconds(),
            end: window.end_seconds(),
            text: text.clone(),
            speaker: *speaker,
        });
        writer.append(window, speaker.and_then(|s| speakers.get(s)).map(String::as_str), &text)?;
        position = position.max(window.end_seconds());
        emit(&Event::Progress {
            done: done + 1,
            total: segments.len(),
            position,
        });
    }

    emit(&Event::Step { step: Step::Write });
    let (lines, file) = writer.finish()?;
    emit(&Event::Done {
        lines,
        elapsed: started.elapsed().as_secs_f64(),
        file,
    });
    Ok(())
}

fn detect(
    engine: &transcribe::Engine,
    state: &mut whisper_rs::WhisperState,
    tracks: &[Vec<f32>],
    segments: &[(usize, windows::Window)],
) -> Result<String> {
    let mut votes: Vec<String> = Vec::new();
    for (track, window) in segments.iter().take(3) {
        votes.push(engine.detect_language(state, &tracks[*track][window.start..window.end])?);
    }
    let mut best = ("en".to_string(), 0);
    for code in &votes {
        let count = votes.iter().filter(|v| *v == code).count();
        if count > best.1 {
            best = (code.clone(), count);
        }
    }
    Ok(best.0)
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
