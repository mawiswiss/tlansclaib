use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Result, anyhow};
use engine::protocol::Event;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::guard;
use crate::models::Models;
use crate::system::{Monitor, Stats};

pub struct ActiveRun {
    child: Option<CommandChild>,
    pid: u32,
    swap_at_start: u64,
    saw_error: bool,
    _awake: Option<keepawake::KeepAwake>,
}

#[derive(Default)]
pub struct RunState(pub Mutex<Option<ActiveRun>>);

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum AppEvent {
    Cancelled,
}

pub fn engine_pid(app: &AppHandle) -> Option<u32> {
    app.state::<RunState>().0.lock().unwrap().as_ref().map(|r| r.pid)
}

pub fn output_file(audio: &Path, output_dir: Option<&Path>) -> PathBuf {
    let stem = audio.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "recording".into());
    let dir = output_dir
        .map(Path::to_path_buf)
        .or_else(|| audio.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    dir.join(format!("{stem}_transcript.txt"))
}

pub fn start(app: &AppHandle, audio: &Path, model_id: &str, language: &str, output_dir: Option<&Path>) -> Result<()> {
    let state = app.state::<RunState>();
    if state.0.lock().unwrap().is_some() {
        return Err(anyhow!("A transcription is already running."));
    }
    if !audio.is_file() {
        return Err(anyhow!("{} does not exist.", audio.display()));
    }
    let (entry, model_path) = app.state::<Models>().installed_path(model_id)?;
    let monitor = app.state::<std::sync::Arc<Monitor>>();
    let (available, swap_at_start) = monitor.memory();
    guard::can_start(available, entry.ram_bytes()).map_err(|e| anyhow!(e))?;

    let output = output_file(audio, output_dir);
    let (mut events, child) = app
        .shell()
        .sidecar("tlansclaib-engine")?
        .args([
            "transcribe",
            "--model",
            &model_path.to_string_lossy(),
            "--audio",
            &audio.to_string_lossy(),
            "--output",
            &output.to_string_lossy(),
            "--language",
            language,
        ])
        .spawn()?;
    let awake = keepawake::Builder::default()
        .idle(true)
        .sleep(true)
        .reason("Transcribing a recording")
        .app_name("tlansclaib")
        .app_reverse_domain("tlansclaib")
        .create()
        .map_err(|e| log::warn!("cannot keep the computer awake: {e}"))
        .ok();
    log::info!("started the engine (pid {}) on {} with {}", child.pid(), audio.display(), entry.file);
    *state.0.lock().unwrap() = Some(ActiveRun {
        pid: child.pid(),
        child: Some(child),
        swap_at_start,
        saw_error: false,
        _awake: awake,
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => match serde_json::from_slice::<Event>(&line) {
                    Ok(event) => {
                        match &event {
                            Event::Error { message } => {
                                log::error!("engine: {message}");
                                if let Some(run) = app.state::<RunState>().0.lock().unwrap().as_mut() {
                                    run.saw_error = true;
                                }
                            }
                            Event::Done { lines, elapsed, file } => {
                                log::info!("done: {lines} lines in {elapsed:.1} s, {}", file.display());
                            }
                            Event::Model { device, threads, language, windows } => {
                                log::info!("model loaded on {device} with {threads} threads, language {language}, {windows} windows");
                            }
                            _ => {}
                        }
                        let _ = app.emit("engine-event", &event);
                    }
                    Err(_) => log::warn!(target: "engine", "{}", String::from_utf8_lossy(&line).trim_end()),
                },
                CommandEvent::Stderr(line) => log::info!(target: "engine", "{}", String::from_utf8_lossy(&line).trim_end()),
                CommandEvent::Error(message) => log::error!(target: "engine", "{message}"),
                CommandEvent::Terminated(payload) => {
                    let run = app.state::<RunState>().0.lock().unwrap().take();
                    if run.is_some_and(|run| payload.code != Some(0) && !run.saw_error) {
                        let _ = app.emit(
                            "engine-event",
                            Event::Error {
                                message: format!(
                                    "The engine stopped unexpectedly (exit code {}). The log file has details.",
                                    payload.code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())
                                ),
                            },
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

pub fn cancel(app: &AppHandle) {
    let run = app.state::<RunState>().0.lock().unwrap().take();
    if let Some(mut run) = run {
        if let Some(child) = run.child.take() {
            let _ = child.kill();
        }
        let _ = app.emit("engine-event", AppEvent::Cancelled);
        log::info!("cancelled the engine");
    }
}

pub fn guard_tick(app: &AppHandle, stats: &Stats) {
    let stop = {
        let state = app.state::<RunState>();
        let run = state.0.lock().unwrap();
        match run.as_ref() {
            Some(run) => guard::should_stop(stats.memory_free, stats.swap_used, run.swap_at_start, guard::memory_floor()),
            None => None,
        }
    };
    if let Some(message) = stop {
        let run = app.state::<RunState>().0.lock().unwrap().take();
        if let Some(child) = run.and_then(|mut run| run.child.take()) {
            let _ = child.kill();
        }
        log::error!("{message}");
        let _ = app.emit("engine-event", Event::Error { message });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_goes_next_to_the_audio_unless_a_folder_is_given() {
        assert_eq!(
            output_file(Path::new("/recordings/meeting.m4a"), None),
            PathBuf::from("/recordings/meeting_transcript.txt")
        );
        assert_eq!(
            output_file(Path::new("/recordings/meeting.m4a"), Some(Path::new("/out"))),
            PathBuf::from("/out/meeting_transcript.txt")
        );
    }
}
