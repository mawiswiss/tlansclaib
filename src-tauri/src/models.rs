use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::guard;
use crate::validate;

const BUNDLED: &str = include_str!("../resources/models.json");
const LINKS: &str = "custom-models.json";
const TOO_HEAVY: &str = "too-heavy.json";

/// A model file added by the user, used where it lies and never deleted by the app.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Link {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    /// The card title in the models dialog, without the language its chip already shows.
    #[serde(default)]
    pub title: Option<String>,
    pub languages: Vec<String>,
    #[serde(default)]
    pub language_name: Option<String>,
    /// The setup modes this model belongs to: minimal, essential, precise. Missing in an override keeps the bundled value.
    #[serde(default)]
    pub setups: Option<Vec<String>>,
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
    pub linked: bool,
    /// Why the model failed on this computer. Automatic skips it until a run with it finishes.
    pub too_heavy: Option<String>,
}

pub struct Models {
    pub dir: PathBuf,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub id: String,
    pub bytes: u64,
    pub total: u64,
}

impl Models {
    pub fn new(dir: PathBuf) -> Models {
        Models {
            dir,
            downloads: Mutex::new(HashMap::new()),
        }
    }

    pub fn registry(&self) -> Result<Vec<ModelEntry>> {
        let bundled: Vec<ModelEntry> = serde_json::from_str(BUNDLED).expect("the bundled models.json is valid");
        let override_file = self.dir.join("models.json");
        match std::fs::read_to_string(&override_file) {
            Ok(text) => Ok(merge(bundled, serde_json::from_str::<Vec<ModelEntry>>(&text).context("Could not read the custom model catalog (models.json)")?)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(bundled),
            Err(error) => Err(error).context("Could not open the custom model catalog (models.json)"),
        }
    }

    pub fn list(&self) -> Result<Vec<ModelStatus>> {
        let registry = self.registry()?;
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
                    linked: false,
                    too_heavy: None,
                }
            })
            .collect();
        let known: Vec<&str> = registry.iter().map(|e| e.file.as_str()).collect();
        let files = std::fs::read_dir(&self.dir).context("Could not read the models folder")?;
        let paths = files.map(|entry| entry.map(|file| file.path())).collect::<std::io::Result<Vec<_>>>()?;
        let mut custom: Vec<ModelStatus> = paths
            .into_iter()
            .filter(|p| p.extension().is_some_and(|e| e == "bin"))
            .filter(|p| !known.contains(&p.file_name().unwrap_or_default().to_string_lossy().as_ref()))
            .filter_map(|path| custom_entry(&path, &registry))
            .collect();
        custom.sort_by(|a, b| a.entry.name.cmp(&b.entry.name));
        list.extend(custom);
        list.extend(self.links()?.iter().map(|link| linked_entry(link, &registry)));
        let marks = self.too_heavy();
        for model in &mut list {
            model.too_heavy = marks.get(&model.entry.id).cloned();
        }
        Ok(list)
    }

    fn too_heavy(&self) -> BTreeMap<String, String> {
        let text = match std::fs::read_to_string(self.dir.join(TOO_HEAVY)) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return BTreeMap::new(),
            Err(error) => {
                log::warn!("could not open {TOO_HEAVY}: {error}");
                return BTreeMap::new();
            }
        };
        serde_json::from_str(&text).unwrap_or_else(|error| {
            log::warn!("could not read {TOO_HEAVY}: {error}");
            BTreeMap::new()
        })
    }

    fn save_too_heavy(&self, marks: &BTreeMap<String, String>) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let part = self.dir.join(format!("{TOO_HEAVY}.part"));
        std::fs::write(&part, serde_json::to_vec_pretty(marks)?)?;
        std::fs::rename(&part, self.dir.join(TOO_HEAVY))?;
        Ok(())
    }

    pub fn mark_too_heavy(&self, id: &str, reason: &str) -> Result<()> {
        let mut marks = self.too_heavy();
        marks.insert(id.to_string(), reason.to_string());
        self.save_too_heavy(&marks)
    }

    /// Returns whether the model was marked.
    pub fn clear_too_heavy(&self, id: &str) -> Result<bool> {
        let mut marks = self.too_heavy();
        if marks.remove(id).is_none() {
            return Ok(false);
        }
        self.save_too_heavy(&marks)?;
        Ok(true)
    }

    pub fn links(&self) -> Result<Vec<Link>> {
        match std::fs::read_to_string(self.dir.join(LINKS)) {
            Ok(text) => serde_json::from_str(&text).context("Could not read linked models (custom-models.json)"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error).context("Could not open linked models (custom-models.json)"),
        }
    }

    fn save_links(&self, links: &[Link]) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let part = self.dir.join(format!("{LINKS}.part"));
        std::fs::write(&part, serde_json::to_vec_pretty(links)?)?;
        std::fs::rename(&part, self.dir.join(LINKS))?;
        Ok(())
    }

    pub fn link(&self, source: &Path) -> Result<ModelStatus> {
        let info = validate::check(source, None).map_err(|reason| anyhow!(reason))?;
        let path = source.canonicalize().with_context(|| format!("cannot read {}", source.display()))?;
        let id = format!("linked:{}", &crate::validate::hex(&Sha256::digest(path.to_string_lossy().as_bytes()))[..12]);
        let mut links = self.links()?;
        if !links.iter().any(|l| l.id == id) {
            let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            links.push(Link { id: id.clone(), name: default_name(&file), path: path.clone() });
            self.save_links(&links)?;
            log::info!("linked model {} ({})", file, info.label());
        }
        self.find(&id)
    }

    pub fn unlink(&self, id: &str) -> Result<()> {
        let mut links = self.links()?;
        let before = links.len();
        links.retain(|l| l.id != id);
        if links.len() == before {
            return Err(anyhow!("This model is not a linked file."));
        }
        self.save_links(&links)?;
        self.clear_too_heavy(id)?;
        Ok(())
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err(anyhow!("A model name needs 1 to 60 characters."));
        }
        let mut links = self.links()?;
        let link = links.iter_mut().find(|l| l.id == id).ok_or_else(|| anyhow!("Only a model added from a file can be renamed."))?;
        link.name = name.to_string();
        self.save_links(&links)
    }

    pub fn find(&self, id: &str) -> Result<ModelStatus> {
        self.list()?
            .into_iter()
            .find(|m| m.entry.id == id)
            .ok_or_else(|| anyhow!("unknown model {id}"))
    }

    pub fn installed_path(&self, id: &str) -> Result<(ModelEntry, PathBuf)> {
        let status = self.find(id)?;
        if status.linked && !status.installed {
            return Err(anyhow!("The file of {} is no longer at {}.", status.entry.name, status.entry.file));
        }
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
        let result = fetch(&entry.name, &url, &part, entry.size_bytes, entry.sha256.as_deref(), &cancel, |bytes, total| {
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
            None => {
                let status = self.link(source)?;
                let _ = app.emit("models-changed", ());
                return Ok(status);
            }
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
            let size = source.metadata()?.len();
            guard::can_download(free_disk(&self.dir), size).map_err(|e| anyhow!(e))?;
            let part = self.dir.join(format!("{file_name}.part"));
            std::fs::copy(source, &part).with_context(|| format!("cannot copy into {}", self.dir.display()))?;
            std::fs::rename(&part, &target)?;
        }
        let _ = app.emit("models-changed", ());
        log::info!("added model {} ({})", file_name, info.label());
        let id = entry.map(|e| e.id).unwrap_or_else(|| format!("custom:{file_name}"));
        self.find(&id)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        if self.links()?.iter().any(|l| l.id == id) {
            return Err(anyhow!("A model added from a file is unlinked, not deleted. Its file stays where it is."));
        }
        let (_, path) = self.installed_path(id)?;
        std::fs::remove_file(&path)?;
        self.clear_too_heavy(id)?;
        Ok(())
    }
}

fn merge(bundled: Vec<ModelEntry>, extra: Vec<ModelEntry>) -> Vec<ModelEntry> {
    let mut merged = bundled;
    for entry in extra {
        match merged.iter_mut().find(|e| e.id == entry.id) {
            Some(existing) => {
                let setups = entry.setups.clone().or_else(|| existing.setups.take());
                *existing = ModelEntry { setups, ..entry };
            }
            None => merged.push(entry),
        }
    }
    merged
}

fn default_name(file: &str) -> String {
    let stem = file.strip_suffix(".bin").unwrap_or(file);
    stem.strip_prefix("ggml-").unwrap_or(stem).to_string()
}

/// The memory need of a listed model with the same architecture and quantization, else a guess from the size.
fn estimated_ram(size: u64, architecture: &str, quantization: &str, registry: &[ModelEntry]) -> f32 {
    registry
        .iter()
        .find(|e| e.architecture.as_deref() == Some(architecture) && e.quantization.as_deref() == Some(quantization) && e.ram_gb > 0.0)
        .map(|e| e.ram_gb)
        .unwrap_or(((size as f64 * 1.2 / (1u64 << 30) as f64) + 1.0) as f32)
}

fn linked_entry(link: &Link, registry: &[ModelEntry]) -> ModelStatus {
    let info = engine::model_file::inspect(&link.path).ok();
    let size = link.path.metadata().map(|m| m.len()).unwrap_or(0);
    let installed = info.is_some();
    ModelStatus {
        entry: ModelEntry {
            id: link.id.clone(),
            name: link.name.clone(),
            title: None,
            languages: vec![if info.as_ref().is_none_or(|i| i.multilingual) { "all" } else { "en" }.to_string()],
            language_name: None,
            setups: None,
            recommended: String::new(),
            file: link.path.to_string_lossy().into_owned(),
            size_bytes: size,
            sha256: None,
            ram_gb: info
                .as_ref()
                .map(|i| estimated_ram(size, &i.architecture, &i.quantization, registry))
                .unwrap_or(0.0),
            url: None,
            architecture: info.as_ref().map(|i| i.architecture.clone()),
            quantization: info.as_ref().map(|i| i.quantization.clone()),
            source: None,
            license: None,
        },
        installed,
        path: installed.then(|| link.path.to_string_lossy().into_owned()),
        label: info.map(|i| i.label()),
        custom: true,
        linked: true,
        too_heavy: None,
    }
}

fn custom_entry(path: &Path, registry: &[ModelEntry]) -> Option<ModelStatus> {
    let info = engine::model_file::inspect(path).ok()?;
    let file = path.file_name()?.to_string_lossy().into_owned();
    let size = path.metadata().ok()?.len();
    Some(ModelStatus {
        entry: ModelEntry {
            id: format!("custom:{file}"),
            name: file.trim_end_matches(".bin").trim_start_matches("ggml-").to_string(),
            title: None,
            languages: vec![if info.multilingual { "all" } else { "en" }.to_string()],
            language_name: None,
            setups: None,
            recommended: "Added from a file".into(),
            file,
            size_bytes: size,
            sha256: None,
            ram_gb: estimated_ram(size, &info.architecture, &info.quantization, registry),
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
        linked: false,
        too_heavy: None,
    })
}

pub fn free_disk(dir: &Path) -> u64 {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| dir.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
        .unwrap_or(u64::MAX)
}

const SPEED_PROBE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";

pub async fn measure_speed() -> Result<f64> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(12)).build()?;
    let response = client
        .get(SPEED_PROBE)
        .header(reqwest::header::RANGE, "bytes=0-33554431")
        .send()
        .await
        .context("no connection to the model server")?
        .error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut bytes = 0u64;
    let mut started: Option<Instant> = None;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("the speed test was interrupted")?;
        let since = *started.get_or_insert_with(Instant::now);
        bytes += chunk.len() as u64;
        if since.elapsed() >= Duration::from_secs(4) {
            break;
        }
    }
    let seconds = started.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
    if bytes < (256 << 10) || seconds <= 0.0 {
        return Err(anyhow!("the speed test received too little data"));
    }
    Ok(bytes as f64 / seconds)
}

pub async fn fetch(
    name: &str,
    url: &str,
    part: &Path,
    size: u64,
    sha256: Option<&str>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<()> {
    let response = reqwest::get(url)
        .await
        .with_context(|| format!("cannot reach {url}"))?
        .error_for_status()
        .with_context(|| format!("the download of {name} failed"))?;
    let total = response.content_length().unwrap_or(size);
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
    if let Some(expected) = sha256 {
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
    fn links_a_model_file_where_it_lies_and_unlinks_it_without_deleting() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-links-{}", std::process::id()));
        let elsewhere = dir.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let file = elsewhere.join("ggml-my-thai-q8_0.bin");
        let header: Vec<u8> = [0x67676d6cu32, 51866, 1500, 1280, 20, 32, 448, 1280, 4, 4, 128, 7]
            .iter()
            .flat_map(|w| w.to_le_bytes())
            .collect();
        std::fs::write(&file, &header).unwrap();
        let models = Models::new(dir.join("models"));

        let linked = models.link(&file).unwrap();
        assert!(linked.linked && linked.custom && linked.installed);
        assert_eq!(linked.entry.name, "my-thai-q8_0");
        assert_eq!(models.link(&file).unwrap().entry.id, linked.entry.id);
        assert_eq!(models.links().unwrap().len(), 1);
        assert!(models.delete(&linked.entry.id).unwrap_err().to_string().contains("unlinked, not deleted"));
        assert!(file.is_file());

        models.rename(&linked.entry.id, "  My Thai  ").unwrap();
        assert_eq!(models.find(&linked.entry.id).unwrap().entry.name, "My Thai");
        assert!(models.rename(&linked.entry.id, " ").is_err());

        std::fs::rename(&file, elsewhere.join("moved.bin")).unwrap();
        let missing = models.find(&linked.entry.id).unwrap();
        assert!(!missing.installed);
        assert!(models.installed_path(&linked.entry.id).unwrap_err().to_string().contains("no longer at"));

        models.unlink(&linked.entry.id).unwrap();
        assert!(models.find(&linked.entry.id).is_err());
        assert!(elsewhere.join("moved.bin").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
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

    #[test]
    #[ignore]
    fn measures_the_connection_speed() {
        let speed = tokio::runtime::Runtime::new().unwrap().block_on(measure_speed()).unwrap();
        assert!(speed > 10_000.0, "{speed}");
        eprintln!("{:.1} MB/s", speed / 1e6);
    }

    #[test]
    fn the_speed_probe_is_a_listed_model() {
        let bundled: Vec<ModelEntry> = serde_json::from_str(BUNDLED).unwrap();
        assert!(bundled.iter().any(|e| e.url.as_deref() == Some(SPEED_PROBE)));
    }

    // Needs the network: cargo test -p tlansclaib -- --ignored
    #[test]
    #[ignore]
    fn downloads_and_validates_the_minimal_model() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-download-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bundled: Vec<ModelEntry> = serde_json::from_str(BUNDLED).unwrap();
        let entry = bundled.into_iter().find(|e| e.id == "large-v3-turbo-q5_0").unwrap();
        let part = dir.join("minimal.part");
        let mut reports = 0;
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(fetch(&entry.name, entry.url.as_ref().unwrap(), &part, entry.size_bytes, entry.sha256.as_deref(), &AtomicBool::new(false), |_, _| reports += 1))
            .unwrap();
        assert!(reports >= 2);
        assert_eq!(part.metadata().unwrap().len(), entry.size_bytes);
        let info = validate::check(&part, Some(&entry)).unwrap();
        assert_eq!(info.label(), "large-v3-turbo, q5_0");
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
    fn an_override_without_setups_keeps_the_bundled_modes() {
        let mut bundled = entry("a", "A");
        bundled.setups = Some(vec!["essential".into()]);
        let merged = merge(vec![bundled.clone()], vec![entry("a", "A2")]);
        assert_eq!(merged[0].setups, bundled.setups);
        let mut moved = entry("a", "A3");
        moved.setups = Some(vec![]);
        assert_eq!(merge(vec![bundled], vec![moved])[0].setups, Some(vec![]));
    }

    #[test]
    fn every_mode_has_one_all_language_model_and_one_model_per_language() {
        let list: Vec<ModelEntry> = serde_json::from_str(BUNDLED).unwrap();
        for mode in ["minimal", "essential", "precise"] {
            let members: Vec<&ModelEntry> = list.iter().filter(|e| e.setups.as_ref().is_some_and(|s| s.iter().any(|m| m == mode))).collect();
            assert_eq!(members.iter().filter(|e| e.languages == ["all"]).count(), 1, "{mode}");
            let mut seen: Vec<(String, Option<String>)> = Vec::new();
            for member in members.iter().filter(|e| e.languages != ["all"]) {
                for language in &member.languages {
                    let key = (language.clone(), member.language_name.clone());
                    assert!(!seen.contains(&key), "{mode} has two models for {key:?}");
                    seen.push(key);
                }
            }
        }
        let modes = ["minimal", "essential", "precise"];
        assert!(list.iter().flat_map(|e| e.setups.iter().flatten()).all(|m| modes.contains(&m.as_str())));
    }

    #[test]
    fn a_models_folder_lists_entries_and_custom_files() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let header = |words: [u32; 12]| -> Vec<u8> { words.iter().flat_map(|w| w.to_le_bytes()).collect() };
        let turbo = header([0x67676d6c, 51866, 1500, 1280, 20, 32, 448, 1280, 20, 4, 128, 1008]);
        let tiny = header([0x67676d6c, 51866, 1500, 384, 6, 4, 448, 384, 6, 4, 80, 1001]);
        std::fs::write(dir.join("ggml-large-v3-turbo-q5_0.bin"), &turbo).unwrap();
        std::fs::write(dir.join("ggml-tiny.bin"), &tiny).unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let models = Models::new(dir.clone());
        let list = models.list().unwrap();
        let listed = list.iter().find(|m| m.entry.id == "large-v3-turbo-q5_0").unwrap();
        assert!(listed.installed && !listed.custom);
        assert_eq!(listed.label.as_deref(), Some("large-v3-turbo, q5_0"));
        let old = list.iter().find(|m| m.entry.id == "custom:ggml-tiny.bin").unwrap();
        assert!(old.custom && old.installed);
        assert_eq!(old.entry.name, "tiny");
        assert!(list.iter().filter(|m| m.installed).count() == 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_model_marked_too_heavy_lists_its_reason_until_cleared_or_deleted() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-too-heavy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let header: Vec<u8> = [0x67676d6cu32, 51866, 1500, 1280, 20, 32, 448, 1280, 20, 4, 128, 1008].iter().flat_map(|w| w.to_le_bytes()).collect();
        std::fs::write(dir.join("ggml-large-v3-turbo-q5_0.bin"), &header).unwrap();
        let models = Models::new(dir.clone());
        let reason = |models: &Models| models.find("large-v3-turbo-q5_0").unwrap().too_heavy;
        assert_eq!(reason(&models), None);
        models.mark_too_heavy("large-v3-turbo-q5_0", "It ran out of memory.").unwrap();
        assert_eq!(reason(&models).as_deref(), Some("It ran out of memory."));
        assert!(models.clear_too_heavy("large-v3-turbo-q5_0").unwrap());
        assert!(!models.clear_too_heavy("large-v3-turbo-q5_0").unwrap());
        assert_eq!(reason(&models), None);
        models.mark_too_heavy("large-v3-turbo-q5_0", "It ran out of memory.").unwrap();
        models.delete("large-v3-turbo-q5_0").unwrap();
        std::fs::write(dir.join("ggml-large-v3-turbo-q5_0.bin"), &header).unwrap();
        assert_eq!(reason(&models), None);
        std::fs::write(dir.join(TOO_HEAVY), "not json").unwrap();
        assert_eq!(reason(&models), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn damaged_model_metadata_is_reported_without_replacing_it() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-model-errors-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let links = dir.join(LINKS);
        std::fs::write(&links, "not json").unwrap();
        let models = Models::new(dir.clone());
        assert!(models.list().unwrap_err().to_string().contains("linked models"));
        assert!(models.rename("linked:missing", "New name").is_err());
        assert_eq!(std::fs::read_to_string(&links).unwrap(), "not json");

        std::fs::write(&links, "[]").unwrap();
        std::fs::write(dir.join("models.json"), "not json").unwrap();
        assert!(models.list().unwrap_err().to_string().contains("custom model catalog"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
