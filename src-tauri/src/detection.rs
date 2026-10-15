use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, anyhow};
use engine::speakers::{EMBEDDING_FILE, LIBRARY_FILE, SEGMENTATION_FILE, SHERPA_ONNX_VERSION};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::guard;
use crate::models::{DownloadProgress, fetch, free_disk};

pub const ID: &str = "speaker-detection";
const VERSION_FILE: &str = "version.txt";

pub struct Download {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts-lib.tar.bz2",
    size: 8_292_111,
    sha256: "f3e0cbd86cc3f38dad30c97921b40e9a8bcc6f2c943777eb76ad77176993e417",
});
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-osx-x64-shared-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-x64-shared-no-tts-lib.tar.bz2",
    size: 9_538_955,
    sha256: "c4d94cce92b6e04df1f17d247c3ac4e61b21359be80e940a0408e039e36a4d7e",
});
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts-lib.tar.bz2",
    size: 7_536_080,
    sha256: "a1253e665c4f236119c443c8932a8acfca32a546c78c05962d483c9a0eae21b7",
});
#[cfg(not(any(
    all(target_os = "macos", any(target_arch = "aarch64", target_arch = "x86_64")),
    all(target_os = "windows", target_arch = "x86_64")
)))]
const RUNTIME: Option<Download> = None;

const SEGMENTATION: Download = Download {
    name: SEGMENTATION_FILE,
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.int8.onnx",
    size: 1_540_506,
    sha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
};

const EMBEDDING: Download = Download {
    name: EMBEDDING_FILE,
    url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    size: 28_281_164,
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
};

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub available: bool,
    pub installed: bool,
    pub downloading: bool,
    pub download_bytes: u64,
    pub disk_bytes: u64,
}

pub struct Detection {
    pub dir: PathBuf,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl Detection {
    pub fn new(models_dir: &Path) -> Detection {
        Detection { dir: models_dir.join(ID), cancel: Mutex::new(None) }
    }

    pub fn installed(&self) -> bool {
        engine::speakers::library_path(&self.dir).is_file()
            && self.dir.join(SEGMENTATION_FILE).is_file()
            && self.dir.join(EMBEDDING_FILE).is_file()
            && std::fs::read_to_string(self.dir.join(VERSION_FILE)).is_ok_and(|v| v.trim() == SHERPA_ONNX_VERSION)
    }

    pub fn status(&self) -> Status {
        let installed = self.installed();
        Status {
            available: RUNTIME.is_some(),
            installed,
            downloading: self.cancel.lock().unwrap().is_some(),
            download_bytes: RUNTIME.as_ref().map(|r| r.size).unwrap_or(0) + SEGMENTATION.size + EMBEDDING.size,
            disk_bytes: if installed { folder_size(&self.dir) } else { 0 },
        }
    }

    pub async fn download(&self, app: &AppHandle) -> Result<()> {
        let runtime = RUNTIME.as_ref().ok_or_else(|| anyhow!("Speaker detection is not available on this kind of computer."))?;
        let total = runtime.size + SEGMENTATION.size + EMBEDDING.size;
        let parent = self.dir.parent().unwrap_or(&self.dir).to_path_buf();
        std::fs::create_dir_all(&parent)?;
        guard::can_download(free_disk(&parent), total * 2).map_err(|e| anyhow!(e))?;
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut current = self.cancel.lock().unwrap();
            if current.is_some() {
                return Err(anyhow!("Speaker detection is already downloading."));
            }
            *current = Some(cancel.clone());
        }
        let staging = parent.join(format!("{ID}.part"));
        let result = self.fetch_all(app, runtime, &staging, &cancel, total).await;
        *self.cancel.lock().unwrap() = None;
        match result {
            Ok(()) => {
                if self.dir.exists() {
                    std::fs::remove_dir_all(&self.dir)?;
                }
                std::fs::rename(&staging, &self.dir)?;
                let _ = app.emit("models-changed", ());
                Ok(())
            }
            Err(error) => {
                let _ = std::fs::remove_dir_all(&staging);
                let _ = app.emit("models-changed", ());
                if cancel.load(Ordering::Relaxed) { Ok(()) } else { Err(error) }
            }
        }
    }

    async fn fetch_all(&self, app: &AppHandle, runtime: &Download, staging: &Path, cancel: &AtomicBool, total: u64) -> Result<()> {
        if staging.exists() {
            std::fs::remove_dir_all(staging)?;
        }
        std::fs::create_dir_all(staging)?;
        let mut done = 0u64;
        for item in [runtime, &SEGMENTATION, &EMBEDDING] {
            let target = staging.join(item.name);
            fetch(item.name, item.url, &target, item.size, Some(item.sha256), cancel, |bytes, _| {
                let _ = app.emit("download-progress", DownloadProgress { id: ID.into(), bytes: done + bytes, total });
            })
            .await?;
            done += item.size;
        }
        let archive = staging.join(runtime.name);
        unpack_libraries(&archive, &staging.join("lib"))?;
        std::fs::remove_file(&archive)?;
        std::fs::write(staging.join(VERSION_FILE), SHERPA_ONNX_VERSION)?;
        Ok(())
    }

    pub fn cancel(&self) {
        if let Some(flag) = self.cancel.lock().unwrap().as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn remove(&self, app: &AppHandle) -> Result<()> {
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir).with_context(|| format!("cannot remove {}", self.dir.display()))?;
        }
        let _ = app.emit("models-changed", ());
        Ok(())
    }
}

/// Copies the shared libraries out of a sherpa-onnx release archive, flat, and nothing else.
fn unpack_libraries(archive: &Path, into: &Path) -> Result<()> {
    std::fs::create_dir_all(into)?;
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(file));
    let mut found = false;
    for entry in tar.entries()? {
        let mut entry = entry?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry.path()?.into_owned();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        let library = name.ends_with(".dylib") || name.ends_with(".dll") || name.ends_with(".so") || name.contains(".so.");
        if !library || name.contains("cxx-api") {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        std::fs::write(into.join(&name), bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(into.join(&name), std::fs::Permissions::from_mode(0o755))?;
        }
        found |= name == LIBRARY_FILE;
    }
    if !found {
        return Err(anyhow!("the downloaded archive holds no {LIBRARY_FILE}"));
    }
    Ok(())
}

fn folder_size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => folder_size(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(dir: &Path, files: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join("runtime.tar.bz2");
        let encoder = bzip2::write::BzEncoder::new(std::fs::File::create(&path).unwrap(), bzip2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, data) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
        path
    }

    #[test]
    fn unpacks_only_the_libraries_and_needs_the_c_api() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-detection-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lib = format!("pkg/lib/{LIBRARY_FILE}");
        let path = archive(
            &dir,
            &[(&lib, b"c api"), ("pkg/lib/libonnxruntime.dylib", b"ort"), ("pkg/lib/onnxruntime.dll", b"ort"), ("pkg/lib/libsherpa-onnx-cxx-api.dylib", b"x"), ("pkg/lib/sherpa-onnx-c-api.lib", b"x"), ("pkg/README.md", b"x")],
        );
        let into = dir.join("lib");
        unpack_libraries(&path, &into).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(&into).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        let mut expected = vec![LIBRARY_FILE.to_string(), "libonnxruntime.dylib".into(), "onnxruntime.dll".into()];
        expected.sort();
        assert_eq!(names, expected);

        let empty = archive(&dir, &[("pkg/lib/libonnxruntime.dylib", b"ort")]);
        assert!(unpack_libraries(&empty, &dir.join("other")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[ignore = "needs a sherpa-onnx release archive in TLANSCLAIB_SHERPA_ARCHIVE"]
    fn unpacks_a_real_release_archive() {
        let archive = PathBuf::from(std::env::var("TLANSCLAIB_SHERPA_ARCHIVE").unwrap());
        let into = std::env::temp_dir().join(format!("tlansclaib-release-{}", std::process::id()));
        unpack_libraries(&archive, &into).unwrap();
        assert!(into.join(LIBRARY_FILE).is_file());
        std::fs::remove_dir_all(&into).unwrap();
    }
}
