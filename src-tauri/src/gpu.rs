use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize)]
pub struct Gpu {
    pub backend: Option<&'static str>,
    pub name: Option<String>,
    pub free_bytes: Option<u64>,
    pub usable: bool,
}

#[cfg(windows)]
pub async fn vulkan_free(app: &AppHandle) -> Option<u64> {
    use tauri_plugin_shell::ShellExt;
    let probe = app.shell().sidecar("tlansclaib-engine-vulkan").ok()?.arg("gpu-memory").output().await;
    probe
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| serde_json::from_slice::<Option<u64>>(&output.stdout).ok())
        .flatten()
}

#[cfg(windows)]
pub async fn probe(app: &AppHandle, ram_bytes: u64) -> Gpu {
    let free = vulkan_free(app).await;
    Gpu { backend: free.map(|_| "vulkan"), name: None, free_bytes: free, usable: free.is_some_and(|free| crate::guard::can_use_gpu(free, ram_bytes)) }
}

#[cfg(not(windows))]
pub async fn probe(_app: &AppHandle, _ram_bytes: u64) -> Gpu {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        let mut system = sysinfo::System::new();
        system.refresh_cpu_all();
        let name = system.cpus().first().map(|cpu| cpu.brand().trim().to_string()).filter(|name| !name.is_empty());
        return Gpu { backend: Some("metal"), name, free_bytes: None, usable: true };
    }
    Gpu { backend: None, name: None, free_bytes: None, usable: false }
}
