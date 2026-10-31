use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Result, anyhow};
use engine::protocol::{Event, Heard, LoadPart, Step, Timings};
use engine::speakers::Backend;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::guard;
use crate::history::{self, History};
use crate::models::Models;
use crate::stall::{self, Watch};
use crate::system::{Monitor, Stats};
use crate::transcript::{Line, Stored};
use crate::worker::{self, Output, Worker};

pub struct ActiveRun {
    worker: Worker,
    swap_at_start: u64,
    saw_error: bool,
    step: Option<Step>,
    /// None where the engine runs inside the app, whose own work hides whether the engine is stuck.
    watch: Option<Watch>,
    stalled: bool,
    record: Record,
    #[cfg(desktop)]
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
    force: bool,
    language: Option<String>,
    heard: Vec<Heard>,
    device: Option<String>,
    timings: Option<Timings>,
    audio_seconds: Option<f64>,
    speakers: Vec<String>,
    detected: bool,
    video: bool,
    lines: usize,
    transcript_lines: Vec<Line>,
    started: Instant,
    saved: bool,
}

/// The running engine, the lock that lets one run start at a time, and stopped engines that have not ended yet.
#[derive(Default)]
pub struct RunState(pub Mutex<Option<ActiveRun>>, pub tokio::sync::Mutex<()>, Mutex<Vec<Worker>>);

/// How long a start waits for a stopped engine to end. A killed sidecar ends at once, a thread in the app only at its next check.
const STOPPING_LIMIT: Duration = if cfg!(mobile) { Duration::from_secs(30) } else { Duration::from_secs(3) };

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum AppEvent {
    Cancelled,
    Restart { language: String },
    Retry { message: String },
    TooHeavy { model_id: String },
}

/// A start refused for memory. The budgets are the largest model RAM that would start, with and without speaker detection.
#[derive(Debug, Serialize)]
pub struct MemoryRefusal {
    message: String,
    free: u64,
    budget: Option<u64>,
    budget_without_speakers: Option<u64>,
}

impl std::fmt::Display for MemoryRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for MemoryRefusal {}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StartError {
    Memory(MemoryRefusal),
    Other { message: String },
}

impl From<anyhow::Error> for StartError {
    fn from(error: anyhow::Error) -> Self {
        match error.downcast::<MemoryRefusal>() {
            Ok(refusal) => StartError::Memory(refusal),
            Err(error) => StartError::Other { message: format!("{error:#}") },
        }
    }
}

fn memory_refusal(message: String, free: u64, detection: u64, sample_seconds: Option<f64>) -> anyhow::Error {
    anyhow::Error::new(MemoryRefusal {
        message,
        free,
        budget: guard::recording_budget(free, detection, sample_seconds),
        budget_without_speakers: (detection > 0).then(|| guard::recording_budget(free, 0, sample_seconds)).flatten(),
    })
}

fn stall_message(step: Option<Step>) -> String {
    let doing = match step {
        None => "starting",
        Some(Step::Decode) => "reading the audio",
        Some(Step::Speakers) => "finding the speakers",
        Some(Step::Load) => "loading the model",
        Some(Step::Transcribe) => "transcribing",
        Some(Step::Write) => "saving",
    };
    format!(
        "The transcription stopped responding while {doing}, so it was ended after {} s without progress. Try again. If it happens again, the log file has details.",
        stall::LIMIT.as_secs()
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Failure {
    Crash,
    Stall,
    Memory,
    EngineError,
}

/// Why a failure shows the model is too much for this computer. Any other step fails for the recording or speaker detection.
/// An engine error in the language check is about the recording too.
fn too_heavy(failure: Failure, step: Option<Step>, probing: bool) -> Option<&'static str> {
    match (step?, failure) {
        (Step::Load, Failure::Memory) => Some("Memory ran low while it loaded."),
        (Step::Load, Failure::Stall) => Some("It stopped responding while it loaded."),
        (Step::Load, Failure::Crash) => Some("It could not be loaded."),
        (Step::Load, Failure::EngineError) if !probing => Some("It could not be loaded."),
        (Step::Transcribe, Failure::Memory) => Some("Memory ran low while it transcribed."),
        (Step::Transcribe, Failure::Stall) => Some("It stopped responding while it transcribed."),
        (Step::Transcribe, Failure::Crash) => Some("It stopped unexpectedly while it transcribed."),
        _ => None,
    }
}

fn mark_too_heavy(app: &AppHandle, model_id: &str, reason: &str) {
    match app.state::<Models>().mark_too_heavy(model_id, reason) {
        Ok(()) => {
            log::warn!("marked {model_id} as too heavy for this computer: {reason}");
            let _ = app.emit("models-changed", ());
            let _ = app.emit("engine-event", AppEvent::TooHeavy { model_id: model_id.to_string() });
        }
        Err(error) => log::warn!("could not mark {model_id} as too heavy: {error:#}"),
    }
}

fn retry_on_cpu(gpu_attempt: bool, step: Option<Step>, model_ready: bool, code: Option<i32>) -> bool {
    gpu_attempt && step == Some(Step::Load) && !model_ready && code != Some(0)
}

pub fn engine_pid(app: &AppHandle) -> Option<u32> {
    app.state::<RunState>().0.lock().unwrap().as_ref().and_then(|r| r.worker.pid())
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
    pub force: bool,
}

pub async fn start(app: &AppHandle, request: Request<'_>) -> Result<()> {
    let Request { audio, model_id, language, timestamps, speakers, speaker_precision, speaker_backend, transcript, force } = request;
    let detector: Backend = speaker_backend.unwrap_or("sherpa").parse().map_err(|e: String| anyhow!(e))?;
    let state = app.state::<RunState>();
    let _starting = state.1.lock().await;
    if state.0.lock().unwrap().is_some() {
        return Err(anyhow!("A transcription is already running."));
    }
    let monitor = app.state::<Arc<Monitor>>();
    if !stopped_engines_ended(app, &monitor).await {
        #[cfg(mobile)]
        return Err(anyhow!("The last transcription is still stopping. Try again in a moment."));
        #[cfg(desktop)]
        {
            log::warn!("a stopped engine was still running after {} s", STOPPING_LIMIT.as_secs());
            state.2.lock().unwrap().clear();
        }
    }
    if !audio.is_file() {
        return Err(anyhow!("{} does not exist.", audio.display()));
    }
    let (entry, model_path) = app.state::<Models>().installed_path(model_id)?;
    let (free, _) = monitor.memory();
    let detection_ram = if speakers.is_some() { guard::detection_ram(detector, None) } else { 0 };
    if !force && let Err(message) = guard::can_start(free, guard::model_run_ram(entry.ram_bytes()).max(detection_ram)) {
        return Err(memory_refusal(message, free, detection_ram, None));
    }
    let sample_seconds = worker::audio_seconds(app, audio).await?;
    if sample_seconds.is_none() {
        log::warn!("recording length is unavailable, so the decoded audio memory estimate was skipped");
    }
    let (free, swap_at_start) = monitor.memory();
    let detection_ram = if speakers.is_some() { guard::detection_ram(detector, sample_seconds) } else { 0 };
    if !force && let Err(message) = guard::can_start_recording(free, guard::model_run_ram(entry.ram_bytes()), detection_ram, sample_seconds) {
        return Err(memory_refusal(message, free, detection_ram, sample_seconds));
    }
    if force {
        log::warn!("starting without the memory check, as asked");
    }

    let data = app.path().app_data_dir()?;
    guard::can_store_transcript(crate::models::free_disk(&data), sample_seconds).map_err(|e| anyhow!(e))?;
    let transcripts = data.join("transcripts");
    let scratch_dir = data.join("scratch");
    std::fs::create_dir_all(&transcripts)?;
    std::fs::create_dir_all(&scratch_dir)?;
    let id = record_id(SystemTime::now().duration_since(UNIX_EPOCH)?);
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
            return Err(anyhow!("Speaker detection is not installed. Download it next to Speakers, or set Speakers to Disabled."));
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
    #[cfg(any(windows, target_os = "linux"))]
    let engine_name = {
        if crate::gpu::device(app).await.is_some_and(|gpu| guard::can_use_gpu(gpu.free_bytes, entry.ram_bytes())) {
            "tlansclaib-engine-vulkan"
        } else {
            crate::cpu::engine()
        }
    };
    #[cfg(not(any(windows, target_os = "linux")))]
    let engine_name = crate::cpu::engine();
    let metal = cfg!(any(target_os = "macos", all(target_os = "ios", not(target_abi = "sim"))));
    let mut retry_args = args.clone();
    if metal {
        retry_args.push("--cpu".into());
    }
    retry_args.push("--fit-encoder".into());
    let mut gpu_attempt = metal || engine_name == "tlansclaib-engine-vulkan";
    if !gpu_attempt {
        args.push("--fit-encoder".into());
    }
    let backend = if metal { "Metal" } else { "Vulkan" };
    let (mut events, worker) = worker::spawn(app, engine_name, args)?;
    #[cfg(desktop)]
    let awake = keepawake::Builder::default()
        .idle(true)
        .sleep(true)
        .reason("Transcribing a recording")
        .app_name("tlansclaib")
        .app_reverse_domain("tlansclaib")
        .create()
        .map_err(|error| {
            log::warn!("could not prevent sleep during transcription");
            let _ = app.emit("app-error", format!("Could not keep the computer awake for this transcription: {error}"));
        })
        .ok();
    match worker.pid() {
        Some(pid) => log::info!("started the engine (pid {pid})"),
        None => log::info!("started the engine inside the app"),
    }
    *state.0.lock().unwrap() = Some(ActiveRun {
        watch: worker.pid().map(|pid| Watch::new(pid, Instant::now())),
        worker,
        swap_at_start,
        saw_error: false,
        step: None,
        stalled: false,
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
            force,
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
            device: None,
            timings: None,
        },
        #[cfg(desktop)]
        _awake: awake,
    });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let mut step = None;
        let mut model_ready = false;
        let mut probing = false;
        let mut pending_gpu_error = None;
        let mut process_error = None;
        let mut speakers_failed = false;
        while let Some(output) = events.recv().await {
            if matches!(output, Output::Event(_) | Output::Unreadable | Output::Diagnostic) {
                with_own(&app, id, |run| run.watch.as_mut().map(|watch| watch.heard(Instant::now())));
            }
            match output {
                Output::Event(event) => {
                    match &event {
                        Event::Step { step: next } => {
                            step = Some(*next);
                            with_own(&app, id, |run| run.step = step);
                            log::info!("step {next:?} after {:.1} s", started.elapsed().as_secs_f64());
                        }
                        Event::Loading { part } => {
                            probing |= *part == LoadPart::Language;
                            log::info!("loading part {part:?} after {:.1} s", started.elapsed().as_secs_f64());
                        }
                        _ => {}
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
                    speakers_failed |= matches!(&event, Event::Error { .. }) && step == Some(Step::Speakers);
                    if matches!(&event, Event::Error { .. })
                        && let Some(reason) = too_heavy(Failure::EngineError, step, probing)
                        && let Some(model_id) = with_own(&app, id, |run| run.record.model_id.clone())
                    {
                        mark_too_heavy(&app, &model_id, reason);
                    }
                    let forwarded = with_own(&app, id, |run| {
                        let event = match &event {
                            Event::Done { lines, elapsed, timings, .. } => match finish(&app, run, *lines, *elapsed, timings) {
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
                Output::Unreadable => {
                    log::warn!(target: "engine", "unreadable progress event");
                    process_error = Some("The engine sent unreadable progress data.".to_string());
                }
                Output::Diagnostic => log::info!(target: "engine", "engine diagnostic received"),
                Output::Failed(message) => {
                    log::error!(target: "engine", "could not read the engine process");
                    if gpu_attempt && step == Some(Step::Load) && !model_ready {
                        pending_gpu_error = Some(message);
                    } else {
                        process_error = Some(message);
                    }
                }
                Output::Ended(code) => {
                    let stalled = with_own(&app, id, |run| run.stalled).unwrap_or(false);
                    if retry_on_cpu(gpu_attempt, step, model_ready, code) && with_own(&app, id, |_| ()).is_some() {
                        log::warn!("{backend} model startup failed. Retrying on CPU.");
                        let message = if stalled {
                            format!("{backend} stopped responding while loading the model. Retrying on CPU.")
                        } else {
                            format!("{backend} could not load the model. Retrying on CPU.")
                        };
                        let _ = app.emit("engine-event", AppEvent::Retry { message });
                        match worker::spawn(&app, crate::cpu::engine(), retry_args.clone()) {
                            Ok((new_events, worker)) => {
                                let state = app.state::<RunState>();
                                let mut active = state.0.lock().unwrap();
                                if let Some(run) = active.as_mut().filter(|run| run.record.id == id) {
                                    run.watch = worker.pid().map(|pid| Watch::new(pid, Instant::now()));
                                    run.stalled = false;
                                    run.worker = worker;
                                    run.saw_error = false;
                                    run.step = None;
                                    events = new_events;
                                    gpu_attempt = false;
                                    step = None;
                                    model_ready = false;
                                    probing = false;
                                    pending_gpu_error = None;
                                    process_error = None;
                                    continue;
                                }
                                park(&app, worker);
                                break;
                            }
                            Err(error) => {
                                with_own(&app, id, |run| run.saw_error = true);
                                let _ = app.emit(
                                    "engine-event",
                                    Event::Error {
                                        message: format!("The model could not start on the graphics chip ({backend}), and the processor could not take over: {error}"),
                                    },
                                );
                            }
                        }
                    }
                    if let Some(run) = take_own(&app, id) {
                        if !run.saw_error && (code != Some(0) || !run.record.saved) {
                            speakers_failed |= step == Some(Step::Speakers);
                            let failure = if stalled { Some(Failure::Stall) } else if code != Some(0) { Some(Failure::Crash) } else { None };
                            let marked = failure
                                .filter(|_| !retry_on_cpu(gpu_attempt, step, model_ready, code))
                                .and_then(|failure| too_heavy(failure, step, probing));
                            if let Some(reason) = marked {
                                mark_too_heavy(&app, &run.record.model_id, reason);
                            }
                            let message = stalled.then(|| stall_message(step)).or_else(|| pending_gpu_error.take()).or_else(|| process_error.take().map(|error| format!("Could not read the transcription process: {error}"))).unwrap_or_else(|| {
                                        if code == Some(0) {
                                            return "The transcription process ended without saving a result.".into();
                                        }
                                        match code {
                                            Some(code) => format!("The transcription stopped unexpectedly (error code {code})."),
                                            None => "The transcription stopped unexpectedly.".into(),
                                        }
                                    });
                            let _ = app.emit("engine-event", Event::Error { message });
                        }
                        remember_incomplete(&app, &run.record);
                    }
                    if code == Some(0)
                        && let Some(error) = process_error.take()
                    {
                        let _ = app.emit("app-error", format!("Could not read all output from the transcription process: {error}"));
                    }
                    break;
                }
            }
        }
        if let Some(mut run) = take_own(&app, id) {
            run.worker.stop();
            if !run.saw_error {
                let message = pending_gpu_error
                    .or_else(|| process_error.map(|error| format!("Could not read the transcription process: {error}")))
                    .unwrap_or_else(|| "The transcription process ended without a final status.".into());
                let _ = app.emit("engine-event", Event::Error { message });
            }
            remember_incomplete(&app, &run.record);
        }
        if speakers_failed {
            app.state::<crate::detection::Detections>().get(detector).check_after_failure(&app).await;
        }
    });
    Ok(())
}

/// Microseconds stay below 2^53, so the window's JavaScript numbers hold the id exactly.
fn record_id(since_epoch: Duration) -> u64 {
    since_epoch.as_micros() as u64
}

/// Keeps a stopped engine until it has ended, so the next run never shares the memory with it.
fn park(app: &AppHandle, mut worker: Worker) {
    worker.stop();
    app.state::<RunState>().2.lock().unwrap().push(worker);
}

async fn stopped_engines_ended(app: &AppHandle, monitor: &Monitor) -> bool {
    let deadline = Instant::now() + STOPPING_LIMIT;
    loop {
        let waiting = {
            let state = app.state::<RunState>();
            let mut parked = state.2.lock().unwrap();
            parked.retain(|worker| worker.running(monitor));
            parked.len()
        };
        if waiting == 0 {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
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
            record.device = Some(device.clone());
        }
        Event::Line { start, end, text, speaker, words } => {
            if !text.is_empty() {
                record.lines += 1;
            }
            record.transcript_lines.push(Line { start: *start, end: *end, text: text.clone(), speaker: *speaker, words: words.clone() });
        }
        Event::Error { .. } => {
            log::error!("engine reported an error");
            run.saw_error = true;
        }
        _ => {}
    }
}

fn finish(app: &AppHandle, run: &mut ActiveRun, lines: usize, elapsed: f64, timings: &Timings) -> Result<PathBuf> {
    let record = &mut run.record;
    record.timings = Some(timings.clone());
    let entry = entry(record, history::Status::Done, lines, elapsed);
    remember(app, entry, &record.transcript_lines)?;
    record.saved = true;
    match app.state::<Models>().clear_too_heavy(&record.model_id) {
        Ok(true) => {
            log::info!("{} finished a run, so it is no longer marked too heavy", record.model_id);
            let _ = app.emit("models-changed", ());
        }
        Ok(false) => {}
        Err(error) => log::warn!("could not clear the too-heavy mark of {}: {error:#}", record.model_id),
    }
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
        speaker_colors: Vec::new(),
        detected: record.detected,
        video: Some(record.video),
        model_id: Some(record.model_id.clone()),
        speaker_mode: record.speaker_mode.clone(),
        speaker_precision: record.speaker_precision.clone(),
        speaker_backend: record.speaker_backend.clone(),
        title: record.audio.file_stem().map(|name| name.to_string_lossy().into_owned()),
        heard: record.heard.clone(),
        edited: Some(false),
        tracks: None,
        device: record.device.clone(),
        timings: record.timings.clone(),
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
        let _ = app.emit("app-error", format!("Could not save the lines transcribed before the stop: {error:#}"));
    } else {
        let _ = std::fs::remove_file(&record.scratch);
    }
}

pub fn cancel(app: &AppHandle) {
    let run = app.state::<RunState>().0.lock().unwrap().take();
    if let Some(run) = run {
        let ActiveRun { worker, record, .. } = run;
        park(app, worker);
        let _ = app.emit("engine-event", AppEvent::Cancelled);
        log::info!("cancelled the engine");
        remember_incomplete(app, &record);
    }
}

pub async fn restart(app: &AppHandle, language: &str) -> Result<()> {
    let run = app.state::<RunState>().0.lock().unwrap().take();
    let Some(run) = run else {
        return Err(anyhow!("No transcription is running."));
    };
    let _ = std::fs::remove_file(&run.record.scratch);
    log::info!("restarting the engine");
    let _ = app.emit("engine-event", AppEvent::Restart { language: language.to_string() });
    let ActiveRun { worker, record, .. } = run;
    park(app, worker);
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
            force: record.force,
        },
    )
    .await
}

fn stop_stalled(app: &AppHandle, stats: &Stats) {
    let state = app.state::<RunState>();
    let mut active = state.0.lock().unwrap();
    let Some(run) = active.as_mut() else { return };
    if run.stalled || !run.watch.as_mut().is_some_and(|watch| watch.stalled(Instant::now(), stats.engine_usage)) {
        return;
    }
    log::error!("the engine sent nothing and did no work for {} s, so it was stopped", stall::LIMIT.as_secs());
    run.stalled = true;
    run.worker.stop();
}

pub fn guard_tick(app: &AppHandle, stats: &Stats) {
    stop_stalled(app, stats);
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
        if let Some(run) = run {
            let ActiveRun { worker, step, record, .. } = run;
            park(app, worker);
            if let Some(reason) = too_heavy(Failure::Memory, step, false) {
                mark_too_heavy(app, &record.model_id, reason);
            }
            remember_incomplete(app, &record);
        }
        log::error!("{message}");
        let _ = app.emit("engine-event", Event::Error { message });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_memory_refusal_reaches_the_window_with_its_budgets() {
        let gib = 1u64 << 30;
        let refused = StartError::from(memory_refusal("short".into(), 2 * gib, guard::SHERPA_DETECTION_RAM, None));
        let json = serde_json::to_value(&refused).unwrap();
        assert_eq!(json["kind"], "memory");
        assert_eq!(json["budget"], serde_json::Value::Null);
        assert_eq!(json["budget_without_speakers"], gib - guard::WORD_TIMING_RAM);
        let other = serde_json::to_value(StartError::from(anyhow!("gone"))).unwrap();
        assert_eq!(other, serde_json::json!({ "kind": "other", "message": "gone" }));
    }

    #[test]
    fn a_record_id_survives_a_javascript_number_until_the_year_2200() {
        let year_2200 = Duration::from_secs(7_258_118_400);
        assert!(record_id(year_2200) < 1 << 53);
        assert_eq!(record_id(year_2200) as f64 as u64, record_id(year_2200));
    }

    #[test]
    fn retries_only_a_gpu_failure_before_the_model_is_ready() {
        assert!(retry_on_cpu(true, Some(Step::Load), false, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Decode), false, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Load), true, Some(1)));
        assert!(!retry_on_cpu(true, Some(Step::Load), false, Some(0)));
        assert!(!retry_on_cpu(false, Some(Step::Load), false, Some(1)));
    }

    #[test]
    fn only_a_failure_while_loading_or_transcribing_marks_the_model() {
        for failure in [Failure::Crash, Failure::Stall, Failure::Memory, Failure::EngineError] {
            assert!(too_heavy(failure, Some(Step::Load), false).is_some());
            for step in [None, Some(Step::Decode), Some(Step::Speakers), Some(Step::Write)] {
                assert_eq!(too_heavy(failure, step, false), None);
            }
        }
        assert!(too_heavy(Failure::Crash, Some(Step::Load), true).is_some());
        assert_eq!(too_heavy(Failure::EngineError, Some(Step::Load), true), None);
        assert!(too_heavy(Failure::Crash, Some(Step::Transcribe), false).is_some());
        assert!(too_heavy(Failure::Stall, Some(Step::Transcribe), false).is_some());
        assert!(too_heavy(Failure::Memory, Some(Step::Transcribe), false).is_some());
        assert_eq!(too_heavy(Failure::EngineError, Some(Step::Transcribe), false), None);
    }
}
