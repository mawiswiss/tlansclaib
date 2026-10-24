use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow};
use engine::protocol::{Event, Heard, Step};
use engine::speakers::Backend;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::guard;
use crate::history::{self, History};
use crate::models::Models;
use crate::system::{Monitor, Stats};
use crate::transcript::{Line, Stored};

pub struct ActiveRun {
    child: Option<CommandChild>,
    pid: u32,
    swap_at_start: u64,
    saw_error: bool,
    record: Record,
    _awake: Option<keepawake::KeepAwake>,
}

struct Record {
    id: u64,
    audio: PathBuf,
    file: PathBuf,
    scratch: PathBuf,
    replace_id: Option<u64>,
    transcript: Option<PathBuf>,
    model: String,
    model_id: String,
    speaker_mode: Option<String>,
    speaker_precision: Option<String>,
    speaker_backend: Option<String>,
    timestamps: bool,
    language: Option<String>,
    heard: Vec<Heard>,
    audio_seconds: Option<f64>,
    speakers: Vec<String>,
    detected: bool,
    video: bool,
    lines: usize,
    transcript_lines: Vec<Line>,
    started: Instant,
    saved: bool,
}

#[derive(Default)]
pub struct RunState(pub Mutex<Option<ActiveRun>>, pub tokio::sync::Mutex<()>);

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum AppEvent {
    Cancelled,
    Restart { language: String },
    Retry { message: String },
}

#[derive(Deserialize)]
struct AudioInfo {
    sample_seconds: Option<f64>,
}

fn retry_on_cpu(gpu_attempt: bool, step: Option<Step>, model_ready: bool, code: Option<i32>) -> bool {
    gpu_attempt && step == Some(Step::Load) && !model_ready && code != Some(0)
}

pub fn engine_pid(app: &AppHandle) -> Option<u32> {
    app.state::<RunState>().0.lock().unwrap().as_ref().map(|r| r.pid)
}

pub struct Request<'a> {
    pub audio: &'a Path,
    pub model_id: &'a str,
    pub language: &'a str,
    pub timestamps: bool,
    pub speakers: Option<&'a str>,
    pub speaker_precision: Option<&'a str>,
    pub speaker_backend: Option<&'a str>,
    pub transcript: Option<&'a Path>,
}

pub async fn start(app: &AppHandle, request: Request<'_>) -> Result<()> {
    let Request { audio, model_id, language, timestamps, speakers, speaker_precision, speaker_backend, transcript } = request;
    let detector: Backend = speaker_backend.unwrap_or("sherpa").parse().map_err(|e: String| anyhow!(e))?;
    let state = app.state::<RunState>();
    let _starting = state.1.lock().await;
    if state.0.lock().unwrap().is_some() {
        return Err(anyhow!("A transcription is already running."));
    }
    if !audio.is_file() {
        return Err(anyhow!("{} does not exist.", audio.display()));
    }
    let (entry, model_path) = app.state::<Models>().installed_path(model_id)?;
    let monitor = app.state::<Arc<Monitor>>();
    let (free, _) = monitor.memory();
    let detection_ram = if speakers.is_some() { guard::detection_ram(detector) } else { 0 };
    guard::can_start(free, entry.ram_bytes().max(detection_ram)).map_err(|e| anyhow!(e))?;
    let audio_arg = audio.to_string_lossy().into_owned();
    let info = app.shell().sidecar("tlansclaib-engine")?.args(["audio-info", "--audio", &audio_arg]).output().await?;
    if !info.status.success() {
        return Err(anyhow!("Could not inspect the recording. Check that it is a supported audio or video file."));
    }
    let AudioInfo { sample_seconds } = serde_json::from_slice(&info.stdout)?;
    if sample_seconds.is_none() {
        log::warn!("recording length is unavailable, so the decoded audio memory estimate was skipped");
    }
    let (free, swap_at_start) = monitor.memory();
    guard::can_start_recording(free, entry.ram_bytes(), detection_ram, sample_seconds).map_err(|e| anyhow!(e))?;

    let data = app.path().app_data_dir()?;
    guard::can_store_transcript(crate::models::free_disk(&data), sample_seconds).map_err(|e| anyhow!(e))?;
    let transcripts = data.join("transcripts");
    let scratch_dir = data.join("scratch");
    std::fs::create_dir_all(&transcripts)?;
    std::fs::create_dir_all(&scratch_dir)?;
    let id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos() as u64;
    let output = transcripts.join(format!("{id}.json"));
    let scratch = scratch_dir.join(format!("{id}.txt"));
    let replace_id = transcript.map(|file| app.state::<History>().by_file(file)).transpose()?.flatten().map(|entry| entry.id);
    let mut args = vec![
        "transcribe".to_string(),
        "--model".into(),
        model_path.to_string_lossy().into_owned(),
        "--audio".into(),
        audio.to_string_lossy().into_owned(),
        "--output".into(),
        scratch.to_string_lossy().into_owned(),
        "--language".into(),
        language.into(),
    ];
    if !timestamps {
        args.push("--no-timestamps".into());
    }
    if let Some(speakers) = speakers {
        let detections = app.state::<crate::detection::Detections>();
        let detection = detections.get(detector);
        if !detection.installed() {
            return Err(anyhow!("Speaker detection is not set up. Download it under Models, or set Speakers to Off."));
        }
        args.extend([
            "--speakers".into(),
            speakers.to_string(),
            "--speaker-models".into(),
            detection.dir.to_string_lossy().into_owned(),
            "--speaker-backend".into(),
            detector.as_str().into(),
        ]);
        if detector == Backend::Sherpa && speaker_precision == Some("fast") {
            args.extend(["--speaker-precision".into(), "fast".into()]);
        }
    }
    #[cfg(windows)]
    let engine_name = {
        if crate::gpu::device(app).await.is_some_and(|gpu| guard::can_use_gpu(gpu.free_bytes, entry.ram_bytes())) {
            "tlansclaib-engine-vulkan"
        } else {
            "tlansclaib-engine"
        }
    };
    #[cfg(not(windows))]
    let engine_name = "tlansclaib-engine";
    #[cfg(target_os = "macos")]
    let retry_args = {
        let mut args = args.clone();
        args.push("--cpu".into());
        args
    };
    #[cfg(not(target_os = "macos"))]
    let retry_args = args.clone();
    let mut gpu_attempt = cfg!(target_os = "macos") || engine_name == "tlansclaib-engine-vulkan";
    let backend = if cfg!(target_os = "macos") { "Metal" } else { "Vulkan" };
    let (mut events, child) = app.shell().sidecar(engine_name)?.args(args).spawn()?;
    let awake = keepawake::Builder::default()
        .idle(true)
        .sleep(true)
        .reason("Transcribing a recording")
        .app_name("tlansclaib")
        .app_reverse_domain("tlansclaib")
        .create()
        .map_err(|error| {
            log::warn!("could not prevent sleep during transcription");
            let _ = app.emit("app-error", format!("The computer may sleep during transcription: {error}"));
        })
        .ok();
    log::info!("started the engine (pid {})", child.pid());
    *state.0.lock().unwrap() = Some(ActiveRun {
        pid: child.pid(),
        child: Some(child),
        swap_at_start,
        saw_error: false,
        record: Record {
            id,
            audio: audio.to_path_buf(),
            file: output,
            scratch,
            replace_id,
            transcript: transcript.map(Path::to_path_buf),
            model: entry.name.clone(),
            model_id: entry.id.clone(),
            speaker_mode: speakers.map(str::to_string),
            speaker_precision: speakers.filter(|_| detector == Backend::Sherpa).and(speaker_precision).map(str::to_string),
            speaker_backend: speakers.map(|_| detector.as_str().to_string()),
            timestamps,
            language: None,
            heard: Vec::new(),
            audio_seconds: None,
            speakers: Vec::new(),
            detected: false,
            video: false,
            lines: 0,
            transcript_lines: Vec::new(),
            started: Instant::now(),
            saved: false,
        },
        _awake: awake,
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut step = None;
        let mut model_ready = false;
        let mut pending_gpu_error = None;
        let mut process_error = None;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => match serde_json::from_slice::<Event>(&line) {
                    Ok(event) => {
                        if let Event::Step { step: next } = &event {
                            step = Some(*next);
                        }
                        if matches!(&event, Event::Model { .. }) {
                            model_ready = true;
                        }
                        if gpu_attempt && step == Some(Step::Load) && !model_ready
                            && let Event::Error { message } = &event
                        {
                            pending_gpu_error = Some(message.clone());
                            continue;
                        }
                        let forwarded = with_own(&app, id, |run| {
                            let event = match &event {
                                Event::Done { lines, elapsed, timings, .. } => match finish(&app, run, *lines, *elapsed) {
                                    Ok(file) => Event::Done { lines: *lines, elapsed: *elapsed, file, timings: timings.clone() },
                                    Err(error) => Event::Error { message: format!("Could not save the transcription: {error:#}") },
                                },
                                _ => {
                                    track(run, &event);
                                    event
                                }
                            };
                            let _ = app.emit("engine-event", &event);
                        });
                        if forwarded.is_none() {
                            break;
                        }
                    }
                    Err(_) => {
                        log::warn!(target: "engine", "unreadable progress event");
                        process_error = Some("The engine sent unreadable progress data.".to_string());
                    }
                },
                CommandEvent::Stderr(_) => log::info!(target: "engine", "engine diagnostic received"),
                CommandEvent::Error(message) => {
                    log::error!(target: "engine", "could not read the engine process");
                    if gpu_attempt && step == Some(Step::Load) && !model_ready {
                        pending_gpu_error = Some(message);
                    } else {
                        process_error = Some(message);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if retry_on_cpu(gpu_attempt, step, model_ready, payload.code) && with_own(&app, id, |_| ()).is_some() {
                        log::warn!("{backend} model startup failed. Retrying on CPU.");
                        let _ = app.emit(
                            "engine-event",
                            AppEvent::Retry {
                                message: format!("{backend} could not load the model. Retrying on CPU."),
                            },
                        );
                        let retry = (|| -> Result<_> { Ok(app.shell().sidecar("tlansclaib-engine")?.args(retry_args.clone()).spawn()?) })();
                        match retry {
                            Ok((new_events, child)) => {
                                let state = app.state::<RunState>();
                                let mut active = state.0.lock().unwrap();
                                if let Some(run) = active.as_mut().filter(|run| run.record.id == id) {
                                    run.pid = child.pid();
                                    run.child = Some(child);
                                    run.saw_error = false;
                                    events = new_events;
                                    gpu_attempt = false;
                                    step = None;
                                    model_ready = false;
                                    pending_gpu_error = None;
                                    process_error = None;
                                    continue;
                                }
                                let _ = child.kill();
                                break;
                            }
                            Err(error) => {
                                with_own(&app, id, |run| run.saw_error = true);
                                let _ = app.emit(
                                    "engine-event",
                                    Event::Error {
                                        message: format!("{backend} model startup failed, and the CPU retry could not start: {error}"),
                                    },
                                );
                            }
                        }
                    }
                    if let Some(run) = take_own(&app, id) {
                        if !run.saw_error && (payload.code != Some(0) || !run.record.saved) {
                            let _ = app.emit(
                                "engine-event",
                                Event::Error {
                                    message: pending_gpu_error.take().or_else(|| process_error.take().map(|error| format!("Could not read the transcription process: {error}"))).unwrap_or_else(|| {
                                        if payload.code == Some(0) {
                                            return "The transcription process ended without saving a result.".into();
                                        }
                                        format!(
                                            "The engine stopped unexpectedly (exit code {}). The log file has details.",
                                            payload.code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())
                                        )
                                    }),
                                },
                            );
                        }
                        remember_incomplete(&app, &run.record);
                    }
                    if payload.code == Some(0)
                        && let Some(error) = process_error.take()
                    {
                        let _ = app.emit("app-error", format!("Could not read all output from the transcription process: {error}"));
                    }
                    break;
                }
                _ => {}
            }
        }
        if let Some(mut run) = take_own(&app, id) {
            if let Some(child) = run.child.take() {
                let _ = child.kill();
            }
            if !run.saw_error {
                let message = pending_gpu_error
                    .or_else(|| process_error.map(|error| format!("Could not read the transcription process: {error}")))
                    .unwrap_or_else(|| "The transcription process ended without a final status.".into());
                let _ = app.emit("engine-event", Event::Error { message });
            }
            remember_incomplete(&app, &run.record);
        }
    });
    Ok(())
}

fn with_own<T>(app: &AppHandle, id: u64, f: impl FnOnce(&mut ActiveRun) -> T) -> Option<T> {
    let state = app.state::<RunState>();
    let mut active = state.0.lock().unwrap();
    active.as_mut().filter(|run| run.record.id == id).map(f)
}

fn take_own(app: &AppHandle, id: u64) -> Option<ActiveRun> {
    let state = app.state::<RunState>();
    let mut active = state.0.lock().unwrap();
    if active.as_ref().is_some_and(|run| run.record.id == id) { active.take() } else { None }
}

fn track(run: &mut ActiveRun, event: &Event) {
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
        Event::Model { device, threads, language, windows, heard, .. } => {
            log::info!("model loaded on {device} with {threads} threads, language {language}, {windows} windows");
            record.language = Some(language.clone());
            record.heard = heard.clone();
        }
        Event::Line { start, end, text, speaker } => {
            if !text.is_empty() {
                record.lines += 1;
            }
            record.transcript_lines.push(Line { start: *start, end: *end, text: text.clone(), speaker: *speaker });
        }
        Event::Error { .. } => {
            log::error!("engine reported an error");
            run.saw_error = true;
        }
        _ => {}
    }
}

fn finish(app: &AppHandle, run: &mut ActiveRun, lines: usize, elapsed: f64) -> Result<PathBuf> {
    let record = &mut run.record;
    let entry = entry(record, history::Status::Done, lines, elapsed);
    remember(app, entry, &record.transcript_lines)?;
    record.saved = true;
    if let Some(id) = record.replace_id && let Err(error) = app.state::<History>().remove(id) {
        crate::report_history_error(app, "The new transcription was saved", &error);
    }
    let _ = std::fs::remove_file(&record.scratch);
    Ok(record.file.clone())
}

fn entry(record: &Record, status: history::Status, lines: usize, elapsed: f64) -> history::Entry {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    history::Entry {
        id: record.id,
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
        file_sha256: None,
        speakers: record.speakers.clone(),
        detected: record.detected,
        video: Some(record.video),
        model_id: Some(record.model_id.clone()),
        speaker_mode: record.speaker_mode.clone(),
        speaker_precision: record.speaker_precision.clone(),
        speaker_backend: record.speaker_backend.clone(),
        title: record.audio.file_stem().map(|name| name.to_string_lossy().into_owned()),
        heard: record.heard.clone(),
        edited: Some(false),
    }
}

fn remember(app: &AppHandle, mut entry: history::Entry, lines: &[Line]) -> Result<()> {
    let history = app.state::<History>();
    Stored::new(entry.clone(), lines.to_vec()).write(&entry.file)?;
    entry.file_sha256 = Some(crate::fingerprint::transcript(&entry.file)?);
    history.add(entry)?;
    let _ = app.emit("history-changed", ());
    Ok(())
}

fn remember_incomplete(app: &AppHandle, record: &Record) {
    if record.saved {
        return;
    }
    if record.lines == 0 {
        let _ = std::fs::remove_file(&record.scratch);
        return;
    }
    let elapsed = record.started.elapsed().as_secs_f64();
    if let Err(error) = remember(app, entry(record, history::Status::Incomplete, record.lines, elapsed), &record.transcript_lines) {
        let _ = app.emit("app-error", format!("The partial transcription could not be saved: {error:#}"));
    } else {
        let _ = std::fs::remove_file(&record.scratch);
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

pub async fn restart(app: &AppHandle, language: &str) -> Result<()> {
    let run = app.state::<RunState>().0.lock().unwrap().take();
    let Some(mut run) = run else {
        return Err(anyhow!("No transcription is running."));
    };
    if let Some(child) = run.child.take() {
        let _ = child.kill();
    }
    let _ = std::fs::remove_file(&run.record.scratch);
    log::info!("restarting the engine in another language");
    let _ = app.emit("engine-event", AppEvent::Restart { language: language.to_string() });
    let ActiveRun { pid, record, .. } = run;
    let monitor = app.state::<Arc<Monitor>>().inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        while monitor.is_running(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
    })
    .await;
    start(
        app,
        Request {
            audio: &record.audio,
            model_id: &record.model_id,
            language,
            timestamps: record.timestamps,
            speakers: record.speaker_mode.as_deref(),
            speaker_precision: record.speaker_precision.as_deref(),
            speaker_backend: record.speaker_backend.as_deref(),
            transcript: record.transcript.as_deref(),
        },
    )
    .await
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
    fn retries_only_a_gpu_failure_before_the_model_is_ready() {
        assert!(retry_on_cpu(true, Some(Step::Load), false, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Decode), false, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Load), true, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Load), false, Some(0)));
        assert!(!retry_on_cpu(false, Some(Step::Load), false, Some(1)));
    }
}
