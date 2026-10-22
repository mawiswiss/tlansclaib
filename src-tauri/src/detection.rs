use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, anyhow};
use engine::speakers::{DETECTION_VERSION, LIBRARY_FILE, MODEL_FILE, MODEL_SHA256, MODEL_SIZE};
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
    name: "parakeet-v0.6.1-lib-macos-metal-arm64.tar.gz",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-macos-metal-arm64.tar.gz",
    size: 1_346_646,
    sha256: "1847118600359355c899619e263275d83b59f81dcc34fcca6ba4e6b9aac67db0",
});
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const RUNTIME: Option<Download> = Some(Download {
    name: "parakeet-v0.6.1-lib-macos-cpu-x64.tar.gz",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-macos-cpu-x64.tar.gz",
    size: 1_461_523,
    sha256: "4575814a5abb2d8d78b657750a3418cf2178765aa8f2f4ebfd692bf78fda9e7d",
});
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const RUNTIME: Option<Download> = Some(Download {
    name: "parakeet-v0.6.1-lib-win-cpu-x64.zip",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-win-cpu-x64.zip",
    size: 1_169_291,
    sha256: "95b41515efeab246094d1793a1c0a12d727bc1cc01e4c28fe37a16a994b26774",
});
#[cfg(not(any(
    all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    ),
    all(target_os = "windows", target_arch = "x86_64")
)))]
const RUNTIME: Option<Download> = None;

const MODEL: Download = Download {
    name: MODEL_FILE,
    url: "https://huggingface.co/mudler/Nemotron-3-Diarization-GGUF/resolve/main/nemotron-3-diarization-f16.gguf",
    size: MODEL_SIZE,
    sha256: MODEL_SHA256,
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
        Detection {
            dir: models_dir.join(ID),
            cancel: Mutex::new(None),
        }
    }

    pub fn installed(&self) -> bool {
        engine::speakers::library_path(&self.dir).is_file()
            && std::fs::metadata(self.dir.join(MODEL_FILE)).is_ok_and(|m| m.len() == MODEL_SIZE)
            && std::fs::read_to_string(self.dir.join(VERSION_FILE))
                .is_ok_and(|v| v.trim() == DETECTION_VERSION)
    }

    pub fn status(&self) -> Status {
        let installed = self.installed();
        Status {
            available: RUNTIME.is_some(),
            installed,
            downloading: self.cancel.lock().unwrap().is_some(),
            download_bytes: RUNTIME.as_ref().map(|r| r.size).unwrap_or(0) + MODEL.size,
            disk_bytes: if installed { folder_size(&self.dir) } else { 0 },
        }
    }

    pub async fn download(&self, app: &AppHandle) -> Result<()> {
        let runtime = RUNTIME.as_ref().ok_or_else(|| {
            anyhow!("Speaker detection is not available on this kind of computer.")
        })?;
        let total = runtime.size + MODEL.size;
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
                if cancel.load(Ordering::Relaxed) {
                    Ok(())
                } else {
                    Err(error)
                }
            }
        }
    }

    async fn fetch_all(
        &self,
        app: &AppHandle,
        runtime: &Download,
        staging: &Path,
        cancel: &AtomicBool,
        total: u64,
    ) -> Result<()> {
        if staging.exists() {
            std::fs::remove_dir_all(staging)?;
        }
        std::fs::create_dir_all(staging)?;
        let mut done = 0u64;
        for item in [runtime, &MODEL] {
            let target = staging.join(item.name);
            fetch(
                item.name,
                item.url,
                &target,
                item.size,
                Some(item.sha256),
                cancel,
                |bytes, _| {
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgress {
                            id: ID.into(),
                            bytes: done + bytes,
                            total,
                        },
                    );
                },
            )
            .await?;
            done += item.size;
        }
        let archive = staging.join(runtime.name);
        unpack_libraries(&archive, &staging.join("lib"), LIBRARY_FILE)?;
        std::fs::remove_file(&archive)?;
        std::fs::write(
            staging.join("OpenMDW-1.1.txt"),
            include_str!("../resources/openmdw-1.1.txt"),
        )?;
        std::fs::write(
            staging.join("NOTICE.txt"),
            "Nemotron 3 Diarization by NVIDIA. GGUF conversion by mudler. Runtime: parakeet.cpp by LocalAI contributors.\n",
        )?;
        std::fs::write(staging.join(VERSION_FILE), DETECTION_VERSION)?;
        Ok(())
    }

    pub fn cancel(&self) {
        if let Some(flag) = self.cancel.lock().unwrap().as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn remove(&self, app: &AppHandle) -> Result<()> {
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)
                .with_context(|| format!("cannot remove {}", self.dir.display()))?;
        }
        let _ = app.emit("models-changed", ());
        Ok(())
    }
}

fn unpack_libraries(archive: &Path, into: &Path, expected: &str) -> Result<()> {
    std::fs::create_dir_all(into)?;
    let mut found = false;
    if archive.extension().is_some_and(|ext| ext == "zip") {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)?;
            if entry.is_file() {
                let name = Path::new(entry.name())
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::to_owned);
                found |= copy_entry(name.as_deref(), &mut entry, into, expected)?;
            }
        }
    } else {
        let file = std::fs::File::open(archive)?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        for entry in tar.entries()? {
            let mut entry = entry?;
            if entry.header().entry_type().is_file() {
                let path = entry.path()?.into_owned();
                let name = path.file_name().and_then(|n| n.to_str());
                found |= copy_entry(name, &mut entry, into, expected)?;
            }
        }
    }
    if !found {
        return Err(anyhow!("the downloaded archive holds no {expected}"));
    }
    Ok(())
}

fn copy_entry(
    name: Option<&str>,
    source: &mut impl Read,
    into: &Path,
    expected: &str,
) -> Result<bool> {
    let Some(name) = name.filter(|name| *name == expected || *name == "LICENSE") else {
        return Ok(false);
    };
    let target = into.join(name);
    std::io::copy(source, &mut std::fs::File::create(&target)?)?;
    #[cfg(unix)]
    if name == expected {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(name == expected)
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
    use std::io::Write;

    #[test]
    fn extracts_only_library_and_license_from_tar() {
        let dir =
            std::env::temp_dir().join(format!("tlansclaib-detection-tar-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("runtime.tar.gz");
        let encoder = flate2::write::GzEncoder::new(
            std::fs::File::create(&path).unwrap(),
            flate2::Compression::fast(),
        );
        let mut builder = tar::Builder::new(encoder);
        for (name, data) in [
            (format!("pkg/{LIBRARY_FILE}"), b"c api".as_slice()),
            ("pkg/LICENSE".into(), b"license"),
            ("pkg/README.md".into(), b"skip"),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
        let into = dir.join("lib");
        unpack_libraries(&path, &into, LIBRARY_FILE).unwrap();
        assert!(into.join(LIBRARY_FILE).is_file());
        assert!(into.join("LICENSE").is_file());
        assert!(!into.join("README.md").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn extracts_only_library_and_license_from_zip() {
        let dir =
            std::env::temp_dir().join(format!("tlansclaib-detection-zip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("runtime.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, data) in [
            (format!("pkg/{LIBRARY_FILE}"), b"c api".as_slice()),
            ("pkg/LICENSE".into(), b"license"),
            ("pkg/README.md".into(), b"skip"),
        ] {
            writer
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
        let into = dir.join("lib");
        unpack_libraries(&path, &into, LIBRARY_FILE).unwrap();
        assert!(into.join(LIBRARY_FILE).is_file());
        assert!(into.join("LICENSE").is_file());
        assert!(!into.join("README.md").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
