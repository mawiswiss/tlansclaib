use std::path::Path;

use anyhow::Result;
use engine::protocol::Event;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use crate::system::Monitor;

#[cfg_attr(mobile, allow(dead_code))]
pub enum Output {
    Event(Event),
    Unreadable,
    Diagnostic,
    Failed(String),
    Ended(Option<i32>),
}

#[derive(Deserialize, Serialize)]
pub struct Language {
    code: String,
    name: String,
}

pub use imp::{Worker, audio_seconds, languages};

/// Starts `tlansclaib-engine` with the arguments of one of its commands, the command first.
pub fn spawn(app: &AppHandle, engine_name: &str, args: Vec<String>) -> Result<(UnboundedReceiver<Output>, Worker)> {
    imp::spawn(app, engine_name, args)
}

#[cfg(desktop)]
mod imp {
    use super::*;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::{CommandChild, CommandEvent};

    /// The engine as a sidecar process, which a crash cannot take the app down with.
    pub struct Worker {
        child: Option<CommandChild>,
        pid: u32,
    }

    impl Worker {
        pub fn pid(&self) -> Option<u32> {
            Some(self.pid)
        }

        pub fn stop(&mut self) {
            if let Some(child) = self.child.take() {
                let _ = child.kill();
            }
        }

        pub fn running(&self, monitor: &Monitor) -> bool {
            monitor.is_running(self.pid)
        }
    }

    pub fn spawn(app: &AppHandle, engine_name: &str, args: Vec<String>) -> Result<(UnboundedReceiver<Output>, Worker)> {
        let (mut events, child) = app.shell().sidecar(engine_name)?.args(args).spawn()?;
        let pid = child.pid();
        let (sender, receiver) = unbounded_channel();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                let output = match event {
                    CommandEvent::Stdout(line) => serde_json::from_slice::<Event>(&line).map_or(Output::Unreadable, Output::Event),
                    CommandEvent::Stderr(_) => Output::Diagnostic,
                    CommandEvent::Error(message) => Output::Failed(message),
                    CommandEvent::Terminated(payload) => Output::Ended(payload.code),
                    _ => continue,
                };
                if sender.send(output).is_err() {
                    break;
                }
            }
        });
        Ok((receiver, Worker { child: Some(child), pid }))
    }

    #[derive(Deserialize)]
    struct AudioInfo {
        sample_seconds: Option<f64>,
    }

    pub async fn audio_seconds(app: &AppHandle, audio: &Path) -> Result<Option<f64>> {
        let audio = audio.to_string_lossy().into_owned();
        let info = app.shell().sidecar(crate::cpu::engine())?.args(["audio-info", "--audio", &audio]).output().await?;
        if !info.status.success() {
            return Err(anyhow::anyhow!("Could not inspect the recording. Check that it is a supported audio or video file."));
        }
        Ok(serde_json::from_slice::<AudioInfo>(&info.stdout)?.sample_seconds)
    }

    pub async fn languages(app: &AppHandle) -> Result<Vec<Language>> {
        let output = app.shell().sidecar(crate::cpu::engine())?.args(["languages"]).output().await?;
        if !output.status.success() {
            return Err(anyhow::anyhow!("Could not load languages from the transcription engine."));
        }
        Ok(serde_json::from_slice(&output.stdout)?)
    }
}

#[cfg(mobile)]
mod imp {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::JoinHandle;

    use super::*;

    /// The engine as a thread of the app, because iOS starts no other process. A crash in it ends the app.
    pub struct Worker {
        stop: Arc<AtomicBool>,
        thread: JoinHandle<()>,
    }

    impl Worker {
        pub fn pid(&self) -> Option<u32> {
            None
        }

        pub fn stop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
        }

        pub fn running(&self, _: &Monitor) -> bool {
            !self.thread.is_finished()
        }
    }

    pub fn spawn(_: &AppHandle, _: &str, args: Vec<String>) -> Result<(UnboundedReceiver<Output>, Worker)> {
        let args = engine::run::TranscribeArgs::parse(args)?;
        let stop = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = unbounded_channel();
        let flag = stop.clone();
        let thread = std::thread::Builder::new().name("engine".into()).spawn(move || {
            let result = engine::run::transcribe(&args, &mut |event| drop(sender.send(Output::Event(event.clone()))), &flag);
            let _ = sender.send(Output::Ended(Some(if result.is_ok() { 0 } else { 1 })));
        })?;
        Ok((receiver, Worker { stop, thread }))
    }

    pub async fn audio_seconds(_: &AppHandle, audio: &Path) -> Result<Option<f64>> {
        let audio = audio.to_path_buf();
        tauri::async_runtime::spawn_blocking(move || engine::audio::sample_seconds(&audio))
            .await?
            .map_err(|_| anyhow::anyhow!("Could not inspect the recording. Check that it is a supported audio or video file."))
    }

    pub async fn languages(_: &AppHandle) -> Result<Vec<Language>> {
        Ok(engine::transcribe::languages().into_iter().map(|(code, name)| Language { code, name }).collect())
    }
}
