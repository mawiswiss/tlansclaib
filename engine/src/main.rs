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
        /// Output name without extension; writes <output>.txt and <output>_timestamps.txt
        #[arg(long)]
        output: PathBuf,
        /// Language code such as th or en, or auto
        #[arg(long, default_value = "auto")]
        language: String,
        /// Number of threads, default: physical cores minus one
        #[arg(long)]
        threads: Option<usize>,
        /// Run on the CPU even when a GPU is available
        #[arg(long)]
        cpu: bool,
        /// Window length in seconds as MIN-MAX, default 17-23, or 11-15 for Thai, Chinese, Japanese and other dense scripts
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
    let audio = audio::load(audio_path)?;
    emit(&Event::Audio {
        seconds: audio.len() as f64 / engine::RATE as f64,
    });

    emit(&Event::Step { step: Step::Load });
    let mut engine = transcribe::Engine::load(model, threads, use_gpu)?;
    engine.decoding = decoding;
    let mut state = engine.state()?;
    let language = if !engine.is_multilingual() {
        "en".to_string()
    } else if language == "auto" {
        let probe = windows::split(&audio, windows::DEFAULT_MIN_SECONDS, windows::DEFAULT_MAX_SECONDS);
        detect(&engine, &mut state, &audio, &probe)?
    } else {
        language.to_string()
    };
    let (min_window, max_window) = window.unwrap_or_else(|| windows::bounds_for(&language));
    let segments = windows::split(&audio, min_window, max_window);
    emit(&Event::Model {
        device: engine.device.to_string(),
        threads,
        language: language.clone(),
        windows: segments.len(),
    });

    emit(&Event::Step {
        step: Step::Transcribe,
    });
    let mut writer = output::Writer::create(output)?;
    for (done, window) in segments.iter().enumerate() {
        let text = engine.transcribe(&mut state, &audio[window.start..window.end], &language)?;
        emit(&Event::Line {
            start: window.start_seconds(),
            end: window.end_seconds(),
            text: text.clone(),
        });
        writer.append(window, &text)?;
        emit(&Event::Progress {
            done: done + 1,
            total: segments.len(),
            position: window.end_seconds(),
        });
    }

    emit(&Event::Step { step: Step::Write });
    let (lines, txt, timestamps) = writer.finish()?;
    emit(&Event::Done {
        lines,
        elapsed: started.elapsed().as_secs_f64(),
        txt,
        timestamps,
    });
    Ok(())
}

fn detect(
    engine: &transcribe::Engine,
    state: &mut whisper_rs::WhisperState,
    audio: &[f32],
    segments: &[windows::Window],
) -> Result<String> {
    let mut votes: Vec<String> = Vec::new();
    for window in segments.iter().take(3) {
        votes.push(engine.detect_language(state, &audio[window.start..window.end])?);
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
