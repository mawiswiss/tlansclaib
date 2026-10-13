use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::guard;
use crate::validate;

const BUNDLED: &str = include_str!("../resources/models.json");

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub languages: Vec<String>,
    #[serde(default)]
    pub recommended: String,
    pub file: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub ram_gb: f32,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub architecture: Option<String>,
    #[serde(default)]
    pub quantization: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
}

impl ModelEntry {
    pub fn ram_bytes(&self) -> u64 {
        (self.ram_gb as f64 * (1u64 << 30) as f64) as u64
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStatus {
    #[serde(flatten)]
    pub entry: ModelEntry,
    pub installed: bool,
    pub path: Option<String>,
    pub label: Option<String>,
    pub custom: bool,
}

pub struct Models {
    pub dir: PathBuf,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    id: String,
    bytes: u64,
    total: u64,
}

impl Models {
    pub fn new(dir: PathBuf) -> Models {
        Models {
            dir,
            downloads: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self) -> Vec<ModelEntry> {
        let bundled: Vec<ModelEntry> = serde_json::from_str(BUNDLED).expect("the bundled models.json is valid");
        let override_file = self.dir.join("models.json");
        match std::fs::read_to_string(&override_file) {
            Ok(text) => match serde_json::from_str::<Vec<ModelEntry>>(&text) {
                Ok(extra) => merge(bundled, extra),
                Err(error) => {
                    log::warn!("ignoring {}: {error}", override_file.display());
                    bundled
                }
            },
            Err(_) => bundled,
        }
    }

    pub fn list(&self) -> Vec<ModelStatus> {
        let registry = self.registry();
        let mut list: Vec<ModelStatus> = registry
            .iter()
            .map(|entry| {
                let path = self.dir.join(&entry.file);
                let installed = path.is_file();
                ModelStatus {
                    label: installed.then(|| engine::model_file::inspect(&path).ok().map(|i| i.label())).flatten(),
                    installed,
                    path: installed.then(|| path.to_string_lossy().into_owned()),
                    entry: entry.clone(),
                    custom: false,
                }
            })
            .collect();
        let known: Vec<&str> = registry.iter().map(|e| e.file.as_str()).collect();
        if let Ok(files) = std::fs::read_dir(&self.dir) {
            let mut custom: Vec<ModelStatus> = files
                .flatten()
                .map(|f| f.path())
                .filter(|p| p.extension().is_some_and(|e| e == "bin"))
                .filter(|p| !known.contains(&p.file_name().unwrap_or_default().to_string_lossy().as_ref()))
                .filter_map(|path| custom_entry(&path))
                .collect();
            custom.sort_by(|a, b| a.entry.name.cmp(&b.entry.name));
            list.extend(custom);
        }
        list
    }

    pub fn find(&self, id: &str) -> Result<ModelStatus> {
        self.list()
            .into_iter()
            .find(|m| m.entry.id == id)
            .ok_or_else(|| anyhow!("unknown model {id}"))
    }

    pub fn installed_path(&self, id: &str) -> Result<(ModelEntry, PathBuf)> {
        let status = self.find(id)?;
        let path = status
            .path
            .ok_or_else(|| anyhow!("{} is not installed", status.entry.name))?;
        Ok((status.entry, PathBuf::from(path)))
    }

    pub async fn download(&self, app: &AppHandle, id: &str) -> Result<()> {
        let entry = self.find(id)?.entry;
        let url = entry
            .url
            .clone()
            .ok_or_else(|| anyhow!("{} has no download address. Add it from a file instead.", entry.name))?;
        std::fs::create_dir_all(&self.dir)?;
        guard::can_download(free_disk(&self.dir), entry.size_bytes).map_err(|e| anyhow!(e))?;

        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut downloads = self.downloads.lock().unwrap();
            if downloads.contains_key(id) {
                return Err(anyhow!("{} is already downloading", entry.name));
            }
            downloads.insert(id.to_string(), cancel.clone());
        }
        let part = self.dir.join(format!("{}.part", entry.file));
        let id_for_progress = id.to_string();
        let result = fetch(&entry, &url, &part, &cancel, |bytes, total| {
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    id: id_for_progress.clone(),
                    bytes,
                    total,
                },
            );
        })
        .await;
        self.downloads.lock().unwrap().remove(id);
        match result {
            Ok(()) => {
                validate::check(&part, Some(&entry)).map_err(|reason| {
                    let _ = std::fs::remove_file(&part);
                    anyhow!("The downloaded file failed its check: {reason}")
                })?;
                std::fs::rename(&part, self.dir.join(&entry.file))?;
                let _ = app.emit("models-changed", ());
                Ok(())
            }
            Err(error) => {
                let _ = std::fs::remove_file(&part);
                if cancel.load(Ordering::Relaxed) {
                    Ok(())
                } else {
                    Err(error)
                }
            }
        }
    }

    pub fn cancel_download(&self, id: &str) {
        if let Some(flag) = self.downloads.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn add_file(&self, app: &AppHandle, id: Option<&str>, source: &Path) -> Result<ModelStatus> {
        let entry = match id {
            Some(id) => Some(self.find(id)?.entry),
            None => None,
        };
        let info = validate::check(source, entry.as_ref()).map_err(|reason| anyhow!(reason))?;
        std::fs::create_dir_all(&self.dir)?;
        let file_name = match &entry {
            Some(entry) => entry.file.clone(),
            None => source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "ggml-model.bin".into()),
        };
        let target = self.dir.join(&file_name);
        if source != target {
            let part = self.dir.join(format!("{file_name}.part"));
            std::fs::copy(source, &part).with_context(|| format!("cannot copy into {}", self.dir.display()))?;
            std::fs::rename(&part, &target)?;
        }
        let _ = app.emit("models-changed", ());
        log::info!("added model {} ({})", file_name, info.label());
        let id = entry.map(|e| e.id).unwrap_or_else(|| format!("custom:{file_name}"));
        self.find(&id)
    }

    pub fn delete(&self, app: &AppHandle, id: &str) -> Result<()> {
        let (_, path) = self.installed_path(id)?;
        std::fs::remove_file(&path)?;
        let _ = app.emit("models-changed", ());
        Ok(())
    }
}

fn merge(bundled: Vec<ModelEntry>, extra: Vec<ModelEntry>) -> Vec<ModelEntry> {
    let mut merged = bundled;
    for entry in extra {
        match merged.iter_mut().find(|e| e.id == entry.id) {
            Some(existing) => *existing = entry,
            None => merged.push(entry),
        }
    }
    merged
}

fn custom_entry(path: &Path) -> Option<ModelStatus> {
    let info = engine::model_file::inspect(path).ok()?;
    let file = path.file_name()?.to_string_lossy().into_owned();
    let size = path.metadata().ok()?.len();
    Some(ModelStatus {
        entry: ModelEntry {
            id: format!("custom:{file}"),
            name: file.trim_end_matches(".bin").trim_start_matches("ggml-").to_string(),
            languages: vec![if info.multilingual { "all" } else { "en" }.to_string()],
            recommended: "Added from a file".into(),
            file,
            size_bytes: size,
            sha256: None,
            ram_gb: ((size as f64 * 1.2 / (1u64 << 30) as f64) + 1.0) as f32,
            url: None,
            architecture: Some(info.architecture.clone()),
            quantization: Some(info.quantization.clone()),
            source: None,
            license: None,
        },
        installed: true,
        path: Some(path.to_string_lossy().into_owned()),
        label: Some(info.label()),
        custom: true,
    })
}

fn free_disk(dir: &Path) -> u64 {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| dir.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
        .unwrap_or(u64::MAX)
}

async fn fetch(
    entry: &ModelEntry,
    url: &str,
    part: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<()> {
    let response = reqwest::get(url)
        .await
        .with_context(|| format!("cannot reach {url}"))?
        .error_for_status()
        .with_context(|| format!("the download of {} failed", entry.name))?;
    let total = response.content_length().unwrap_or(entry.size_bytes);
    let mut file = tokio::fs::File::create(part).await?;
    let mut stream = response.bytes_stream();
    let mut bytes = 0u64;
    let mut reported = 0u64;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("cancelled"));
        }
        let chunk = chunk.context("the download was interrupted")?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        bytes += chunk.len() as u64;
        if bytes - reported >= 4 << 20 || bytes == total {
            reported = bytes;
            progress(bytes, total);
        }
    }
    file.flush().await?;
    drop(file);
    if let Some(expected) = &entry.sha256 {
        let digest = crate::validate::hex(&hasher.finalize());
        if !digest.eq_ignore_ascii_case(expected) {
            return Err(anyhow!(
                "the downloaded file is not the expected one (checksum mismatch). Try again later."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str) -> ModelEntry {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": name, "languages": ["all"], "file": format!("ggml-{id}.bin")
        }))
        .unwrap()
    }

    #[test]
    fn the_bundled_list_parses_and_has_the_thai_entries() {
        let list: Vec<ModelEntry> = serde_json::from_str(BUNDLED).unwrap();
        assert!(list.iter().any(|e| e.id == "thai-fast"));
        assert!(list.iter().any(|e| e.id == "large-v3-turbo-q5_0" && e.url.is_some()));
        for entry in &list {
            assert!(entry.size_bytes > 0, "{} has no size", entry.id);
            assert!(entry.ram_gb > 0.0, "{} has no memory need", entry.id);
            assert!(entry.file.starts_with("ggml-"), "{} file name", entry.id);
        }
    }

    // Needs the network: cargo test -p tlansclaib -- --ignored
    #[test]
    #[ignore]
    fn downloads_and_validates_the_tiny_model() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-download-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bundled: Vec<ModelEntry> = serde_json::from_str(BUNDLED).unwrap();
        let entry = bundled.into_iter().find(|e| e.id == "tiny").unwrap();
        let part = dir.join("tiny.part");
        let mut reports = 0;
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(fetch(&entry, entry.url.as_ref().unwrap(), &part, &AtomicBool::new(false), |_, _| reports += 1))
            .unwrap();
        assert!(reports >= 2);
        assert_eq!(part.metadata().unwrap().len(), entry.size_bytes);
        let info = validate::check(&part, Some(&entry)).unwrap();
        assert_eq!(info.label(), "tiny, f16");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_override_replaces_by_id_and_appends_the_rest() {
        let bundled = vec![entry("a", "A"), entry("b", "B")];
        let extra = vec![entry("b", "B2"), entry("c", "C")];
        let merged = merge(bundled, extra);
        let names: Vec<&str> = merged.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["A", "B2", "C"]);
    }

    #[test]
    fn a_models_folder_lists_entries_and_custom_files() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let header: Vec<u8> = [0x67676d6cu32, 51866, 1500, 384, 6, 4, 448, 384, 6, 4, 80, 1001]
            .iter()
            .flat_map(|w| w.to_le_bytes())
            .collect();
        std::fs::write(dir.join("ggml-tiny.bin"), &header).unwrap();
        std::fs::write(dir.join("ggml-mine.bin"), &header).unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let models = Models::new(dir.clone());
        let list = models.list();
        let tiny = list.iter().find(|m| m.entry.id == "tiny").unwrap();
        assert!(tiny.installed && !tiny.custom);
        assert_eq!(tiny.label.as_deref(), Some("tiny, f16"));
        let mine = list.iter().find(|m| m.entry.id == "custom:ggml-mine.bin").unwrap();
        assert!(mine.custom && mine.installed);
        assert_eq!(mine.entry.name, "mine");
        assert!(list.iter().filter(|m| m.installed).count() == 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
