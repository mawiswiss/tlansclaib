use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, anyhow};
use engine::speakers::{Backend, nemotron, sherpa};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::guard;
use crate::models::{DownloadProgress, fetch, free_disk};

const VERSION_FILE: &str = "version.txt";

pub struct Download {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const SHERPA_RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts-lib.tar.bz2",
    size: 8_292_111,
    sha256: "f3e0cbd86cc3f38dad30c97921b40e9a8bcc6f2c943777eb76ad77176993e417",
});
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const SHERPA_RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-osx-x64-shared-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-osx-x64-shared-no-tts-lib.tar.bz2",
    size: 9_538_955,
    sha256: "c4d94cce92b6e04df1f17d247c3ac4e61b21359be80e940a0408e039e36a4d7e",
});
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const SHERPA_RUNTIME: Option<Download> = Some(Download {
    name: "sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts-lib.tar.bz2",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts-lib.tar.bz2",
    size: 7_536_080,
    sha256: "a1253e665c4f236119c443c8932a8acfca32a546c78c05962d483c9a0eae21b7",
});
#[cfg(not(any(all(target_os = "macos", any(target_arch = "aarch64", target_arch = "x86_64")), all(target_os = "windows", target_arch = "x86_64"))))]
const SHERPA_RUNTIME: Option<Download> = None;

const SEGMENTATION: Download = Download {
    name: sherpa::SEGMENTATION_FILE,
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.int8.onnx",
    size: 1_540_506,
    sha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
};

const EMBEDDING: Download = Download {
    name: sherpa::EMBEDDING_FILE,
    url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    size: 28_281_164,
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
};

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const PARAKEET_RUNTIME: Option<Download> = Some(Download {
    name: "parakeet-v0.6.1-lib-macos-metal-arm64.tar.gz",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-macos-metal-arm64.tar.gz",
    size: 1_346_646,
    sha256: "1847118600359355c899619e263275d83b59f81dcc34fcca6ba4e6b9aac67db0",
});
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const PARAKEET_RUNTIME: Option<Download> = Some(Download {
    name: "parakeet-v0.6.1-lib-macos-cpu-x64.tar.gz",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-macos-cpu-x64.tar.gz",
    size: 1_461_523,
    sha256: "4575814a5abb2d8d78b657750a3418cf2178765aa8f2f4ebfd692bf78fda9e7d",
});
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const PARAKEET_RUNTIME: Option<Download> = Some(Download {
    name: "parakeet-v0.6.1-lib-win-cpu-x64.zip",
    url: "https://github.com/mudler/parakeet.cpp/releases/download/v0.6.1/parakeet-v0.6.1-lib-win-cpu-x64.zip",
    size: 1_169_291,
    sha256: "95b41515efeab246094d1793a1c0a12d727bc1cc01e4c28fe37a16a994b26774",
});
#[cfg(not(any(all(target_os = "macos", any(target_arch = "aarch64", target_arch = "x86_64")), all(target_os = "windows", target_arch = "x86_64"))))]
const PARAKEET_RUNTIME: Option<Download> = None;

const NEMOTRON_MODEL: Download = Download {
    name: nemotron::MODEL_FILE,
    url: "https://huggingface.co/mudler/Nemotron-3-Diarization-GGUF/resolve/main/nemotron-3-diarization-f16.gguf",
    size: nemotron::MODEL_SIZE,
    sha256: nemotron::MODEL_SHA256,
};

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub backend: &'static str,
    pub available: bool,
    pub installed: bool,
    pub downloading: bool,
    pub download_bytes: u64,
    pub disk_bytes: u64,
}

pub struct Detection {
    pub backend: Backend,
    pub dir: PathBuf,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

/// Both speaker detections. sherpa keeps the folder name of older versions, so their installs stay valid.
pub struct Detections {
    pub sherpa: Detection,
    pub nemotron: Detection,
}

impl Detections {
    pub fn new(models_dir: &Path) -> Detections {
        Detections { sherpa: Detection::new(models_dir, Backend::Sherpa), nemotron: Detection::new(models_dir, Backend::Nemotron) }
    }

    pub fn get(&self, backend: Backend) -> &Detection {
        match backend {
            Backend::Sherpa => &self.sherpa,
            Backend::Nemotron => &self.nemotron,
        }
    }

    pub fn status(&self) -> Vec<Status> {
        vec![self.sherpa.status(), self.nemotron.status()]
    }
}

pub fn id(backend: Backend) -> &'static str {
    match backend {
        Backend::Sherpa => "speaker-detection",
        Backend::Nemotron => "speaker-detection-nemotron",
    }
}

impl Detection {
    fn new(models_dir: &Path, backend: Backend) -> Detection {
        Detection { backend, dir: models_dir.join(id(backend)), cancel: Mutex::new(None) }
    }

    fn runtime(&self) -> Option<&'static Download> {
        match self.backend {
            Backend::Sherpa => SHERPA_RUNTIME.as_ref(),
            Backend::Nemotron => PARAKEET_RUNTIME.as_ref(),
        }
    }

    fn models(&self) -> &'static [Download] {
        match self.backend {
            Backend::Sherpa => &[SEGMENTATION, EMBEDDING],
            Backend::Nemotron => std::slice::from_ref(&NEMOTRON_MODEL),
        }
    }

    fn version(&self) -> &'static str {
        match self.backend {
            Backend::Sherpa => sherpa::SHERPA_ONNX_VERSION,
            Backend::Nemotron => nemotron::DETECTION_VERSION,
        }
    }

    pub fn download_bytes(&self) -> u64 {
        self.runtime().map(|r| r.size).unwrap_or(0) + self.models().iter().map(|m| m.size).sum::<u64>()
    }

    pub fn installed(&self) -> bool {
        let files = match self.backend {
            Backend::Sherpa => {
                sherpa::library_path(&self.dir).is_file() && self.dir.join(sherpa::SEGMENTATION_FILE).is_file() && self.dir.join(sherpa::EMBEDDING_FILE).is_file()
            }
            Backend::Nemotron => {
                nemotron::library_path(&self.dir).is_file()
                    && std::fs::metadata(self.dir.join(nemotron::MODEL_FILE)).is_ok_and(|m| m.len() == nemotron::MODEL_SIZE)
            }
        };
        files && std::fs::read_to_string(self.dir.join(VERSION_FILE)).is_ok_and(|v| v.trim() == self.version())
    }

    pub fn status(&self) -> Status {
        let installed = self.installed();
        Status {
            backend: self.backend.as_str(),
            available: self.runtime().is_some(),
            installed,
            downloading: self.cancel.lock().unwrap().is_some(),
            download_bytes: self.download_bytes(),
            disk_bytes: if installed { folder_size(&self.dir) } else { 0 },
        }
    }

    pub async fn download(&self, app: &AppHandle) -> Result<()> {
        let runtime = self.runtime().ok_or_else(|| anyhow!("Speaker detection is not available on this kind of computer."))?;
        let total = self.download_bytes();
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
        let staging = parent.join(format!("{}.part", id(self.backend)));
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
        let progress_id = id(self.backend);
        let mut done = 0u64;
        for item in std::iter::once(runtime).chain(self.models()) {
            let target = staging.join(item.name);
            fetch(item.name, item.url, &target, item.size, Some(item.sha256), cancel, |bytes, _| {
                let _ = app.emit("download-progress", DownloadProgress { id: progress_id.into(), bytes: done + bytes, total });
            })
            .await?;
            done += item.size;
        }
        let archive = staging.join(runtime.name);
        match self.backend {
            Backend::Sherpa => unpack_sherpa(&archive, &staging.join("lib"))?,
            Backend::Nemotron => {
                unpack_parakeet(&archive, &staging.join("lib"), nemotron::LIBRARY_FILE)?;
                std::fs::write(staging.join("OpenMDW-1.1.txt"), include_str!("../resources/openmdw-1.1.txt"))?;
                std::fs::write(
                    staging.join("NOTICE.txt"),
                    "Nemotron 3 Diarization by NVIDIA. GGUF conversion by mudler. Runtime: parakeet.cpp by LocalAI contributors.\n",
                )?;
            }
        }
        std::fs::remove_file(&archive)?;
        std::fs::write(staging.join(VERSION_FILE), self.version())?;
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
fn unpack_sherpa(archive: &Path, into: &Path) -> Result<()> {
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
        found |= name == sherpa::LIBRARY_FILE;
    }
    if !found {
        return Err(anyhow!("the downloaded archive holds no {}", sherpa::LIBRARY_FILE));
    }
    Ok(())
}

/// Copies the parakeet.cpp library and its licence out of a release archive, tar.gz or zip.
fn unpack_parakeet(archive: &Path, into: &Path, expected: &str) -> Result<()> {
    std::fs::create_dir_all(into)?;
    let mut found = false;
    if archive.extension().is_some_and(|ext| ext == "zip") {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)?;
            if entry.is_file() {
                let name = Path::new(entry.name()).file_name().and_then(|n| n.to_str()).map(str::to_owned);
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

fn copy_entry(name: Option<&str>, source: &mut impl Read, into: &Path, expected: &str) -> Result<bool> {
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

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tlansclaib-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sherpa_archive(dir: &Path, files: &[(&str, &[u8])]) -> PathBuf {
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
    fn unpacks_only_the_sherpa_libraries_and_needs_the_c_api() {
        let dir = scratch("detection-sherpa");
        let lib = format!("pkg/lib/{}", sherpa::LIBRARY_FILE);
        let path = sherpa_archive(
            &dir,
            &[(&lib, b"c api"), ("pkg/lib/libonnxruntime.dylib", b"ort"), ("pkg/lib/onnxruntime.dll", b"ort"), ("pkg/lib/libsherpa-onnx-cxx-api.dylib", b"x"), ("pkg/lib/sherpa-onnx-c-api.lib", b"x"), ("pkg/README.md", b"x")],
        );
        let into = dir.join("lib");
        unpack_sherpa(&path, &into).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(&into).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        let mut expected = vec![sherpa::LIBRARY_FILE.to_string(), "libonnxruntime.dylib".into(), "onnxruntime.dll".into()];
        expected.sort();
        assert_eq!(names, expected);

        let empty = sherpa_archive(&dir, &[("pkg/lib/libonnxruntime.dylib", b"ort")]);
        assert!(unpack_sherpa(&empty, &dir.join("other")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extracts_only_the_parakeet_library_and_license_from_tar() {
        let dir = scratch("detection-tar");
        let path = dir.join("runtime.tar.gz");
        let encoder = flate2::write::GzEncoder::new(std::fs::File::create(&path).unwrap(), flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, data) in [(format!("pkg/{}", nemotron::LIBRARY_FILE), b"c api".as_slice()), ("pkg/LICENSE".into(), b"license"), ("pkg/README.md".into(), b"skip")] {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
        let into = dir.join("lib");
        unpack_parakeet(&path, &into, nemotron::LIBRARY_FILE).unwrap();
        assert!(into.join(nemotron::LIBRARY_FILE).is_file());
        assert!(into.join("LICENSE").is_file());
        assert!(!into.join("README.md").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn extracts_only_the_parakeet_library_and_license_from_zip() {
        let dir = scratch("detection-zip");
        let path = dir.join("runtime.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, data) in [(format!("pkg/{}", nemotron::LIBRARY_FILE), b"c api".as_slice()), ("pkg/LICENSE".into(), b"license"), ("pkg/README.md".into(), b"skip")] {
            writer.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
        let into = dir.join("lib");
        unpack_parakeet(&path, &into, nemotron::LIBRARY_FILE).unwrap();
        assert!(into.join(nemotron::LIBRARY_FILE).is_file());
        assert!(into.join("LICENSE").is_file());
        assert!(!into.join("README.md").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn each_backend_is_installed_from_its_own_folder() {
        let dir = scratch("detection-folders");
        let detections = Detections::new(&dir);
        assert_ne!(detections.sherpa.dir, detections.nemotron.dir);
        assert!(detections.sherpa.dir.ends_with("speaker-detection"));

        let sherpa_dir = &detections.sherpa.dir;
        std::fs::create_dir_all(sherpa_dir.join("lib")).unwrap();
        std::fs::write(sherpa::library_path(sherpa_dir), b"lib").unwrap();
        std::fs::write(sherpa_dir.join(sherpa::SEGMENTATION_FILE), b"s").unwrap();
        std::fs::write(sherpa_dir.join(sherpa::EMBEDDING_FILE), b"e").unwrap();
        std::fs::write(sherpa_dir.join(VERSION_FILE), sherpa::SHERPA_ONNX_VERSION).unwrap();
        assert!(detections.sherpa.installed());
        assert!(!detections.nemotron.installed());

        let nemotron_dir = &detections.nemotron.dir;
        std::fs::create_dir_all(nemotron_dir.join("lib")).unwrap();
        std::fs::write(nemotron::library_path(nemotron_dir), b"lib").unwrap();
        std::fs::File::create(nemotron_dir.join(nemotron::MODEL_FILE)).unwrap().set_len(nemotron::MODEL_SIZE).unwrap();
        std::fs::write(nemotron_dir.join(VERSION_FILE), sherpa::SHERPA_ONNX_VERSION).unwrap();
        assert!(!detections.nemotron.installed(), "a version file of the other backend does not count");
        std::fs::write(nemotron_dir.join(VERSION_FILE), nemotron::DETECTION_VERSION).unwrap();
        assert!(detections.nemotron.installed());
        assert!(detections.sherpa.installed());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
