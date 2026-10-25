use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

const PROBE_LIMIT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize)]
pub struct Gpu {
    pub backend: Option<String>,
    pub name: Option<String>,
    pub free_bytes: Option<u64>,
    pub usable: bool,
    /// On Windows, the largest model that runs on the GPU. A larger one runs on the CPU.
    pub model_budget: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Device {
    pub backend: String,
    pub name: String,
    pub free_bytes: u64,
}

/// The GPU the engine sidecar starts, or None when it has none, fails or hangs.
pub async fn device(app: &AppHandle) -> Option<Device> {
    if cfg!(windows) && !crate::cpu::runs_vulkan_engine() {
        return None;
    }
    let sidecar = if cfg!(windows) { "tlansclaib-engine-vulkan" } else { "tlansclaib-engine" };
    let (mut events, child) = app.shell().sidecar(sidecar).ok()?.arg("probe").spawn().ok()?;
    let read = async {
        let mut stdout = Vec::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => stdout.extend(line),
                CommandEvent::Terminated(payload) => return (payload.code == Some(0)).then_some(stdout),
                _ => {}
            }
        }
        None
    };
    match tokio::time::timeout(PROBE_LIMIT, read).await {
        Ok(stdout) => serde_json::from_slice::<Option<Device>>(&stdout?).ok().flatten(),
        Err(_) => {
            log::warn!("The GPU probe did not answer within {} s.", PROBE_LIMIT.as_secs());
            let _ = child.kill();
            None
        }
    }
}

#[cfg_attr(not(windows), allow(unused_variables))]
pub async fn probe(app: &AppHandle, ram_bytes: u64) -> Gpu {
    let device = device(app).await;
    #[cfg(windows)]
    let usable = device.as_ref().is_some_and(|device| crate::guard::can_use_gpu(device.free_bytes, ram_bytes));
    #[cfg(not(windows))]
    let usable = device.is_some() && cfg!(all(target_os = "macos", target_arch = "aarch64"));
    #[cfg(windows)]
    let model_budget = device.as_ref().map(|device| crate::guard::model_budget(device.free_bytes));
    #[cfg(not(windows))]
    let model_budget = None;
    Gpu {
        backend: device.as_ref().map(|d| d.backend.clone()),
        name: device.as_ref().map(|d| d.name.clone()),
        free_bytes: device.map(|d| d.free_bytes),
        usable,
        model_budget,
    }
}
