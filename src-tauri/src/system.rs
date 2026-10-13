use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sysinfo::{MemoryRefreshKind, Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
pub struct Stats {
    pub cpu: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_free: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub app_memory: u64,
    pub engine_memory: u64,
}

// sysinfo's available memory on macOS also counts pages apps are using, so free is total minus used.
fn free_memory(system: &System) -> u64 {
    system.total_memory().saturating_sub(system.used_memory())
}

pub struct Monitor {
    system: Mutex<System>,
}

impl Monitor {
    pub fn new() -> Arc<Monitor> {
        Arc::new(Monitor {
            system: Mutex::new(System::new()),
        })
    }

    pub fn memory(&self) -> (u64, u64) {
        let mut system = self.system.lock().unwrap();
        system.refresh_memory_specifics(MemoryRefreshKind::everything());
        (free_memory(&system), system.used_swap())
    }

    pub fn sample(&self, engine_pid: Option<u32>) -> Stats {
        let mut system = self.system.lock().unwrap();
        system.refresh_memory_specifics(MemoryRefreshKind::everything());
        system.refresh_cpu_usage();
        let own = Pid::from_u32(std::process::id());
        let mut pids = vec![own];
        if let Some(pid) = engine_pid {
            pids.push(Pid::from_u32(pid));
        }
        system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
        let memory_of = |pid: Pid| system.process(pid).map(|p| p.memory()).unwrap_or(0);
        Stats {
            cpu: system.global_cpu_usage(),
            memory_total: system.total_memory(),
            memory_used: system.used_memory(),
            memory_free: free_memory(&system),
            swap_total: system.total_swap(),
            swap_used: system.used_swap(),
            app_memory: memory_of(own),
            engine_memory: engine_pid.map(|p| memory_of(Pid::from_u32(p))).unwrap_or(0),
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, on_tick: impl Fn(&Stats) + Send + 'static) {
        let monitor = self.clone();
        std::thread::spawn(move || {
            loop {
                let pid = crate::run::engine_pid(&app);
                let stats = monitor.sample(pid);
                on_tick(&stats);
                let _ = app.emit("system-stats", &stats);
                std::thread::sleep(Duration::from_secs(1));
            }
        });
    }
}
