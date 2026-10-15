mod detection;
mod fingerprint;
mod guard;
mod history;
mod models;
mod run;
mod system;
mod transcript;
mod validate;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

use history::History;
use models::{ModelStatus, Models};
use system::Monitor;

#[derive(serde::Deserialize, serde::Serialize)]
struct Language {
    code: String,
    name: String,
}

#[tauri::command]
fn list_models(models: State<Models>) -> Vec<ModelStatus> {
    models.list()
}

#[tauri::command]
fn models_folder(models: State<Models>) -> String {
    models.dir.to_string_lossy().into_owned()
}

#[tauri::command]
async fn download_model(app: AppHandle, id: String) -> Result<(), String> {
    let models = app.state::<Models>();
    models.download(&app, &id).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn cancel_download(models: State<Models>, id: String) {
    models.cancel_download(&id);
}

#[tauri::command]
async fn add_model_file(app: AppHandle, id: Option<String>, path: String) -> Result<ModelStatus, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app2.state::<Models>()
            .add_file(&app2, id.as_deref(), &PathBuf::from(path))
            .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_model(app: AppHandle, models: State<Models>, id: String) -> Result<(), String> {
    models.delete(&id).map_err(|e| format!("{e:#}"))?;
    let _ = app.emit("models-changed", ());
    Ok(())
}

#[tauri::command]
fn unlink_model(app: AppHandle, models: State<Models>, id: String) -> Result<(), String> {
    models.unlink(&id).map_err(|e| format!("{e:#}"))?;
    let _ = app.emit("models-changed", ());
    Ok(())
}

#[tauri::command]
fn rename_model(app: AppHandle, models: State<Models>, id: String, name: String) -> Result<(), String> {
    models.rename(&id, &name).map_err(|e| format!("{e:#}"))?;
    let _ = app.emit("models-changed", ());
    Ok(())
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_languages(app: AppHandle) -> Result<Vec<Language>, String> {
    let output = app
        .shell()
        .sidecar("tlansclaib-engine")
        .map_err(|e| e.to_string())?
        .args(["languages"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_run(app: AppHandle, audio: String, model_id: String, language: String, output_dir: Option<String>) -> Result<(), String> {
    let audio = PathBuf::from(audio);
    let output_dir = output_dir.map(PathBuf::from);
    run::start(
        &app,
        run::Request {
            audio: &audio,
            model_id: &model_id,
            language: &language,
            timestamps: true,
            output_dir: output_dir.as_deref(),
            speakers: None,
            speaker_precision: None,
            transcript: None,
        },
    )
    .map_err(|e| format!("{e:#}"))
}

#[derive(serde::Serialize)]
struct DiskSpace {
    free: u64,
    minimum: u64,
    reserve: u64,
}

#[tauri::command]
fn disk_space(models: State<Models>) -> DiskSpace {
    DiskSpace {
        free: models::free_disk(&models.dir),
        minimum: guard::DISK_MINIMUM,
        reserve: guard::DISK_RESERVE,
    }
}

#[tauri::command]
async fn measure_speed() -> Result<f64, String> {
    models::measure_speed().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn speaker_detection(detection: State<detection::Detection>) -> detection::Status {
    detection.status()
}

#[tauri::command]
async fn download_speaker_detection(app: AppHandle) -> Result<(), String> {
    let detection = app.state::<detection::Detection>();
    detection.download(&app).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn cancel_speaker_detection(detection: State<detection::Detection>) {
    detection.cancel();
}

#[tauri::command]
fn remove_speaker_detection(app: AppHandle, detection: State<detection::Detection>) -> Result<(), String> {
    detection.remove(&app).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn list_history(history: State<History>) -> Vec<history::Listed> {
    history.list()
}

#[tauri::command]
fn remove_history(app: AppHandle, history: State<History>, id: u64) -> Result<(), String> {
    history.remove(id).map_err(|e| format!("{e:#}"))?;
    let _ = app.emit("history-changed", ());
    Ok(())
}

#[tauri::command]
fn set_transcript_timestamps(
    app: AppHandle,
    history: State<History>,
    file: String,
    lines: Vec<transcript::Line>,
    timestamps: bool,
    speakers: Vec<String>,
) -> Result<String, String> {
    let file = Path::new(&file);
    transcript::set_timestamps(file, &lines, timestamps, &speakers).map_err(|e| format!("{e:#}"))?;
    remember_write(&app, &history, file, timestamps, &speakers)
}

#[tauri::command]
fn save_transcript(
    app: AppHandle,
    history: State<History>,
    file: String,
    expected: String,
    lines: Vec<transcript::Line>,
    timestamps: bool,
    speakers: Vec<String>,
) -> Result<String, String> {
    let file = Path::new(&file);
    transcript::save(file, &expected, &lines, timestamps, &speakers).map_err(|e| format!("{e:#}"))?;
    remember_write(&app, &history, file, timestamps, &speakers)
}

#[tauri::command]
fn rename_transcript(app: AppHandle, history: State<History>, file: String, title: String) -> Result<String, String> {
    let from = PathBuf::from(file);
    let to = transcript::rename(&from, &title).map_err(|e| format!("{e:#}"))?;
    if to != from {
        if let Err(error) = history.renamed(&from, &to) {
            log::warn!("cannot save the history: {error:#}");
        }
        let _ = app.emit("history-changed", ());
    }
    Ok(to.to_string_lossy().into_owned())
}

#[tauri::command]
fn transcript_hash(file: String) -> Result<String, String> {
    fingerprint::transcript(Path::new(&file)).map_err(|e| e.to_string())
}

fn remember_write(app: &AppHandle, history: &History, file: &Path, timestamps: bool, speakers: &[String]) -> Result<String, String> {
    if let Err(error) = history.written(file, timestamps, speakers) {
        log::warn!("cannot save the history: {error:#}");
    }
    let _ = app.emit("history-changed", ());
    fingerprint::transcript(file).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct Opened {
    text: String,
    hash: String,
    changed: bool,
    audio: fingerprint::Match,
    times: Option<Vec<(f64, f64)>>,
}

#[tauri::command]
fn open_history(history: State<History>, id: u64) -> Result<Opened, String> {
    let entry = history.get(id).ok_or("This transcript is no longer in the history.")?;
    let text = std::fs::read_to_string(&entry.file).map_err(|e| format!("cannot read {}: {e}", entry.file.display()))?;
    let file = fingerprint::compare(entry.file_sha256.as_deref(), &entry.file, fingerprint::transcript);
    let changed = file == fingerprint::Match::Different;
    let audio = fingerprint::compare(entry.audio_fingerprint.as_deref(), &entry.audio, fingerprint::audio);
    let hash = fingerprint::transcript(&entry.file).map_err(|e| e.to_string())?;
    let times = (file == fingerprint::Match::Same).then(|| history.times(id)).flatten();
    Ok(Opened { text, hash, changed, audio, times })
}

#[tauri::command]
fn check_candidate(history: State<History>, id: u64, kind: history::Kind, path: String) -> Result<fingerprint::Match, String> {
    let entry = history.get(id).ok_or("This transcript is no longer in the history.")?;
    let path = Path::new(&path);
    Ok(match kind {
        history::Kind::Transcript => fingerprint::compare(entry.file_sha256.as_deref(), path, fingerprint::transcript),
        history::Kind::Audio => fingerprint::compare(entry.audio_fingerprint.as_deref(), path, fingerprint::audio),
    })
}

#[tauri::command]
fn relocate_history(app: AppHandle, history: State<History>, id: u64, kind: history::Kind, path: String) -> Result<(), String> {
    history.relocate(id, kind, Path::new(&path)).map_err(|e| format!("{e:#}"))?;
    let _ = app.emit("history-changed", ());
    Ok(())
}

#[tauri::command]
fn cancel_run(app: AppHandle) {
    run::cancel(&app);
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// A development build started with TLANSCLAIB_AUTORUN=<audio file> transcribes it at once.
#[tauri::command]
fn autorun() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("TLANSCLAIB_AUTORUN").ok()
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .max_file_size(5 << 20)
                .build(),
        )
        .manage(run::RunState::default())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let dir = data.join("models");
            std::fs::create_dir_all(&dir)?;
            app.manage(detection::Detection::new(&dir));
            app.manage(Models::new(dir));
            app.manage(History::new(data.join("history.json")));
            let monitor = Monitor::new();
            app.manage(monitor.clone());
            let handle = app.handle().clone();
            monitor.start(app.handle().clone(), move |stats| run::guard_tick(&handle, stats));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_models,
            models_folder,
            download_model,
            cancel_download,
            add_model_file,
            delete_model,
            unlink_model,
            rename_model,
            reveal,
            list_languages,
            start_run,
            cancel_run,
            read_text_file,
            autorun,
            disk_space,
            measure_speed,
            speaker_detection,
            download_speaker_detection,
            cancel_speaker_detection,
            remove_speaker_detection,
            list_history,
            remove_history,
            open_history,
            check_candidate,
            relocate_history,
            set_transcript_timestamps,
            save_transcript,
            transcript_hash,
            rename_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
