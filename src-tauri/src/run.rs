use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow};
use engine::protocol::Event;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::guard;
use crate::history::{self, History};
use crate::models::Models;
use crate::system::{Monitor, Stats};

pub struct ActiveRun {
    child: Option<CommandChild>,
    pid: u32,
    swap_at_start: u64,
    saw_error: bool,
    record: Record,
    _awake: Option<keepawake::KeepAwake>,
}

struct Record {
    audio: PathBuf,
    file: PathBuf,
    model: String,
    model_id: String,
    speaker_mode: Option<String>,
    speaker_precision: Option<String>,
    timestamps: bool,
    language: Option<String>,
    audio_seconds: Option<f64>,
    speakers: Vec<String>,
    detected: bool,
    video: bool,
    lines: usize,
    times: Vec<(f64, f64)>,
    started: Instant,
    saved: bool,
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

pub struct Request<'a> {
    pub audio: &'a Path,
    pub model_id: &'a str,
    pub language: &'a str,
    pub timestamps: bool,
    pub output_dir: Option<&'a Path>,
    pub speakers: Option<&'a str>,
    pub speaker_precision: Option<&'a str>,
    /// Write to this transcript instead of one named after the recording, to transcribe it again.
    pub transcript: Option<&'a Path>,
}

pub fn start(app: &AppHandle, request: Request) -> Result<()> {
    let Request { audio, model_id, language, timestamps, output_dir, speakers, speaker_precision, transcript } = request;
    let state = app.state::<RunState>();
    if state.0.lock().unwrap().is_some() {
        return Err(anyhow!("A transcription is already running."));
    }
    if !audio.is_file() {
        return Err(anyhow!("{} does not exist.", audio.display()));
    }
    if let Some(dir) = output_dir.filter(|d| !d.is_dir()) {
        return Err(anyhow!(
            "The folder {} is not there any more. Choose another one under \"Save to\".",
            dir.display()
        ));
    }
    let (entry, model_path) = app.state::<Models>().installed_path(model_id)?;
    let monitor = app.state::<std::sync::Arc<Monitor>>();
    let (free, swap_at_start) = monitor.memory();
    let detection_ram = if speakers.is_some() { guard::DETECTION_RAM } else { 0 };
    guard::can_start(free, entry.ram_bytes().max(detection_ram)).map_err(|e| anyhow!(e))?;

    if let Some(dir) = transcript.and_then(Path::parent).filter(|d| !d.is_dir()) {
        return Err(anyhow!("The folder {} is not there any more.", dir.display()));
    }
    let output = transcript.map(Path::to_path_buf).unwrap_or_else(|| output_file(audio, output_dir));
    let mut args = vec![
        "transcribe".to_string(),
        "--model".into(),
        model_path.to_string_lossy().into_owned(),
        "--audio".into(),
        audio.to_string_lossy().into_owned(),
        "--output".into(),
        output.to_string_lossy().into_owned(),
        "--language".into(),
        language.into(),
    ];
    if !timestamps {
        args.push("--no-timestamps".into());
    }
    if let Some(speakers) = speakers {
        let detection = app.state::<crate::detection::Detection>();
        if !detection.installed() {
            return Err(anyhow!("Speaker detection is not set up. Download it under Models, or set Speakers to Off."));
        }
        args.extend(["--speakers".into(), speakers.to_string(), "--speaker-models".into(), detection.dir.to_string_lossy().into_owned()]);
        if speaker_precision == Some("fast") {
            args.extend(["--speaker-precision".into(), "fast".into()]);
        }
    }
    let (mut events, child) = app.shell().sidecar("tlansclaib-engine")?.args(args).spawn()?;
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
        record: Record {
            audio: audio.to_path_buf(),
            file: output,
            model: entry.name.clone(),
            model_id: entry.id.clone(),
            speaker_mode: speakers.map(str::to_string),
            speaker_precision: speakers.and(speaker_precision).map(str::to_string),
            timestamps,
            language: None,
            audio_seconds: None,
            speakers: Vec::new(),
            detected: false,
            video: false,
            lines: 0,
            times: Vec::new(),
            started: Instant::now(),
            saved: false,
        },
        _awake: awake,
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => match serde_json::from_slice::<Event>(&line) {
                    Ok(event) => {
                        track(&app, &event);
                        let _ = app.emit("engine-event", &event);
                    }
                    Err(_) => log::warn!(target: "engine", "{}", String::from_utf8_lossy(&line).trim_end()),
                },
                CommandEvent::Stderr(line) => log::info!(target: "engine", "{}", String::from_utf8_lossy(&line).trim_end()),
                CommandEvent::Error(message) => log::error!(target: "engine", "{message}"),
                CommandEvent::Terminated(payload) => {
                    let run = app.state::<RunState>().0.lock().unwrap().take();
                    if let Some(run) = run {
                        if payload.code != Some(0) && !run.saw_error {
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
                        remember_incomplete(&app, &run.record);
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn track(app: &AppHandle, event: &Event) {
    let state = app.state::<RunState>();
    let mut lock = state.0.lock().unwrap();
    let Some(run) = lock.as_mut() else {
        return;
    };
    let record = &mut run.record;
    match event {
        Event::Audio { seconds, speakers, video } => {
            record.audio_seconds = Some(*seconds);
            record.speakers = speakers.clone();
            record.video = *video;
        }
        Event::Speakers { speakers } => {
            record.speakers = speakers.clone();
            record.detected = true;
        }
        Event::Model { device, threads, language, windows } => {
            log::info!("model loaded on {device} with {threads} threads, language {language}, {windows} windows");
            record.language = Some(language.clone());
        }
        Event::Line { start, end, text, .. } if !text.is_empty() => {
            record.lines += 1;
            record.times.push((*start, *end));
        }
        Event::Error { message } => {
            log::error!("engine: {message}");
            run.saw_error = true;
        }
        Event::Done { lines, elapsed, file } => {
            log::info!("done: {lines} lines in {elapsed:.1} s, {}", file.display());
            record.saved = true;
            let entry = entry(record, history::Status::Done, *lines, *elapsed);
            let times = record.times.clone();
            drop(lock);
            remember(app, entry, &times);
        }
        _ => {}
    }
}

fn entry(record: &Record, status: history::Status, lines: usize, elapsed: f64) -> history::Entry {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    history::Entry {
        id: now.as_millis() as u64,
        audio: record.audio.clone(),
        file: record.file.clone(),
        model: record.model.clone(),
        language: record.language.clone(),
        audio_seconds: record.audio_seconds,
        lines,
        elapsed,
        finished_at: now.as_secs(),
        status,
        timestamps: record.timestamps,
        audio_fingerprint: crate::fingerprint::audio(&record.audio).ok(),
        file_sha256: crate::fingerprint::transcript(&record.file).ok(),
        speakers: record.speakers.clone(),
        detected: record.detected,
        video: Some(record.video),
        model_id: Some(record.model_id.clone()),
        speaker_mode: record.speaker_mode.clone(),
        speaker_precision: record.speaker_precision.clone(),
    }
}

fn remember(app: &AppHandle, entry: history::Entry, times: &[(f64, f64)]) {
    let history = app.state::<History>();
    let id = entry.id;
    if let Err(error) = history.add(entry).and_then(|_| history.save_times(id, times)) {
        log::warn!("cannot save the history: {error:#}");
    }
    let _ = app.emit("history-changed", ());
}

fn remember_incomplete(app: &AppHandle, record: &Record) {
    if !record.saved && record.lines > 0 {
        let elapsed = record.started.elapsed().as_secs_f64();
        remember(app, entry(record, history::Status::Incomplete, record.lines, elapsed), &record.times);
    }
}

pub fn cancel(app: &AppHandle) {
    let run = app.state::<RunState>().0.lock().unwrap().take();
    if let Some(mut run) = run {
        if let Some(child) = run.child.take() {
            let _ = child.kill();
        }
        let _ = app.emit("engine-event", AppEvent::Cancelled);
        log::info!("cancelled the engine");
        remember_incomplete(app, &run.record);
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
        if let Some(mut run) = run {
            if let Some(child) = run.child.take() {
                let _ = child.kill();
            }
            remember_incomplete(app, &run.record);
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
