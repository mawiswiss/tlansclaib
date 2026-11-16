use std::path::Path;
use std::time::UNIX_EPOCH;

use anyhow::Result;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::guard;

const MEASURE: &str = "rms-db";

pub fn cache_key(path: &str, size: u64, modified_seconds: u64, buckets: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{MEASURE}\0{path}\0{size}\0{modified_seconds}\0{buckets}"));
    hasher.finalize().iter().take(16).map(|byte| format!("{byte:02x}")).collect()
}

pub async fn compute(app: &AppHandle, path: &Path, buckets: usize) -> Result<Vec<f32>> {
    let buckets = guard::peak_buckets(buckets);
    let meta = std::fs::metadata(path)?;
    let modified = meta.modified()?.duration_since(UNIX_EPOCH).map_or(0, |age| age.as_secs());
    let dir = app.path().app_data_dir()?.join("peaks");
    let cached = dir.join(format!("{}.json", cache_key(&path.to_string_lossy(), meta.len(), modified, buckets)));
    if let Some(peaks) = std::fs::read(&cached).ok().and_then(|bytes| serde_json::from_slice::<Vec<f32>>(&bytes).ok()).filter(|peaks| peaks.len() == buckets) {
        return Ok(peaks);
    }
    let peaks = crate::worker::peaks(app, path, buckets).await?;
    if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&cached, serde_json::to_vec(&peaks)?).is_ok() {
        trim(&dir);
    }
    Ok(peaks)
}

fn trim(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries.flatten().filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path()))).collect();
    files.sort();
    let excess = guard::peak_cache_excess(files.len());
    for (_, file) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_changes_with_every_input() {
        let base = cache_key("a.mp3", 10, 20, 100);
        assert_eq!(base, cache_key("a.mp3", 10, 20, 100));
        assert_eq!(base.len(), 32);
        for other in [cache_key("b.mp3", 10, 20, 100), cache_key("a.mp3", 11, 20, 100), cache_key("a.mp3", 10, 21, 100), cache_key("a.mp3", 10, 20, 101)] {
            assert_ne!(base, other);
        }
    }
}
