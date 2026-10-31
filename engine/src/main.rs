use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use anyhow::Result;
use clap::{Parser, Subcommand};
use engine::protocol::{Event, emit};
use engine::run::{self, TranscribeArgs, parse_window};
use engine::speakers::{nemotron, sherpa};
use engine::{audio, model_file, speakers, transcribe, windows};
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
    Transcribe(TranscribeArgs),
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
        Command::Transcribe(args) => {
            lower_priority();
            run::transcribe(&args, &mut |event| emit(event), &Arc::new(AtomicBool::new(false)))
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
