use std::fs::File;
use std::io::Read;
use std::path::Path;

use engine::model_file::{self, ModelInfo};
use sha2::{Digest, Sha256};

use crate::guard::gb;
use crate::models::ModelEntry;

const HINT: &str = "A model is a whisper.cpp file, usually named ggml-….bin. PyTorch, CTranslate2 and ONNX files from Hugging Face do not work here.";

pub fn check(path: &Path, entry: Option<&ModelEntry>) -> Result<ModelInfo, String> {
    let info = model_file::inspect(path).map_err(|reason| format!("This file is {reason}. {HINT}"))?;
    let Some(entry) = entry else {
        return Ok(info);
    };
    let size = path.metadata().map_err(|e| e.to_string())?.len();
    let wrong = |what: &str| {
        format!(
            "This is not the {} model file ({what}). Expected {} ({}){}.",
            entry.name,
            entry.file,
            gb(entry.size_bytes),
            entry
                .sha256
                .as_ref()
                .map(|s| format!(", SHA-256 {}…", s.get(..12).unwrap_or(s)))
                .unwrap_or_default()
        )
    };
    if entry.size_bytes > 0 && size != entry.size_bytes {
        return Err(wrong(&format!("it is {} and {}", gb(size), info.label())));
    }
    if let Some(expected) = &entry.sha256 {
        let digest = sha256(path).map_err(|e| e.to_string())?;
        if !digest.eq_ignore_ascii_case(expected) {
            return Err(wrong("same size, different checksum"));
        }
    }
    if entry.languages.iter().any(|l| l != "en") && !info.multilingual {
        return Err(format!(
            "This model is English-only and cannot be used as {}.",
            entry.name
        ));
    }
    Ok(info)
}

pub fn sha256(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 4 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tlansclaib-validate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn header(n_vocab: u32) -> Vec<u8> {
        [0x67676d6cu32, n_vocab, 1500, 1280, 20, 32, 448, 1280, 20, 4, 128, 2007]
            .iter()
            .flat_map(|w| w.to_le_bytes())
            .collect()
    }

    fn entry(size: u64, sha: Option<&str>, languages: &[&str]) -> ModelEntry {
        serde_json::from_value(serde_json::json!({
            "id": "thai-fast", "name": "Thai (fast)", "languages": languages,
            "file": "ggml-thai-fast-q8_0.bin", "size_bytes": size, "sha256": sha
        }))
        .unwrap()
    }

    #[test]
    fn a_wrong_file_is_named_with_the_hint() {
        let path = write("model.safetensors", &[&8u64.to_le_bytes()[..], b"{\"a\":1}", &[0; 64]].concat());
        let reason = check(&path, None).unwrap_err();
        assert!(reason.starts_with("This file is a safetensors file"), "{reason}");
        assert!(reason.contains("ggml-"));
    }

    #[test]
    fn a_generic_model_only_needs_a_valid_header() {
        let path = write("ggml-any.bin", &header(51866));
        assert_eq!(check(&path, None).unwrap().label(), "large-v3-turbo, q8_0");
    }

    #[test]
    fn an_entry_file_must_match_size_and_checksum() {
        let bytes = header(51866);
        let path = write("ggml-thai-fast-q8_0.bin", &bytes);
        let digest = sha256(&path).unwrap();
        assert!(check(&path, Some(&entry(bytes.len() as u64, Some(&digest), &["th"]))).is_ok());

        let reason = check(&path, Some(&entry(999, None, &["th"]))).unwrap_err();
        assert!(reason.starts_with("This is not the Thai (fast) model file"), "{reason}");
        assert!(reason.contains("ggml-thai-fast-q8_0.bin"));

        let reason = check(&path, Some(&entry(bytes.len() as u64, Some("00ff"), &["th"]))).unwrap_err();
        assert!(reason.contains("different checksum"), "{reason}");
    }

    #[test]
    fn an_english_only_model_cannot_serve_a_thai_entry() {
        let bytes = header(51864);
        let path = write("ggml-en.bin", &bytes);
        let reason = check(&path, Some(&entry(bytes.len() as u64, None, &["th"]))).unwrap_err();
        assert!(reason.contains("English-only"), "{reason}");
    }
}
