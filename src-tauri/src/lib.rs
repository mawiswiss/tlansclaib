mod guard;
mod models;
mod run;
mod system;
mod validate;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

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
    run::start(
        &app,
        &PathBuf::from(audio),
        &model_id,
        &language,
        output_dir.map(PathBuf::from).as_deref(),
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
            let dir = app.path().app_data_dir()?.join("models");
            std::fs::create_dir_all(&dir)?;
            app.manage(Models::new(dir));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
