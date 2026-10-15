use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};

const SAMPLE: u64 = 4 << 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Match {
    Same,
    Different,
    Unknown,
    Missing,
}

pub fn audio(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    let head = SAMPLE.min(size);
    let mut buffer = vec![0u8; head as usize];
    file.read_exact(&mut buffer)?;
    hasher.update(&buffer);
    let tail = SAMPLE.min(size - head);
    if tail > 0 {
        file.seek(SeekFrom::Start(size - tail))?;
        buffer.resize(tail as usize, 0);
        file.read_exact(&mut buffer)?;
        hasher.update(&buffer);
    }
    Ok(format!("{size}:{}", crate::validate::hex(&hasher.finalize())))
}

pub fn transcript(path: &Path) -> Result<String> {
    Ok(crate::validate::sha256(path)?)
}

pub fn compare(stored: Option<&str>, path: &Path, measure: fn(&Path) -> Result<String>) -> Match {
    if !path.is_file() {
        return Match::Missing;
    }
    match (stored, measure(path)) {
        (Some(stored), Ok(current)) if stored == current => Match::Same,
        (Some(_), Ok(_)) => Match::Different,
        _ => Match::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_same_from_different_content_and_missing_files() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-fingerprint-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let small = dir.join("small.m4a");
        std::fs::write(&small, b"short recording").unwrap();
        let big = dir.join("big.m4a");
        let mut bytes = vec![7u8; (SAMPLE * 3) as usize];
        std::fs::write(&big, &bytes).unwrap();
        let stored = audio(&big).unwrap();

        assert_eq!(compare(Some(&stored), &big, audio), Match::Same);
        bytes[(SAMPLE * 3 - 10) as usize] = 8;
        std::fs::write(&big, &bytes).unwrap();
        assert_eq!(compare(Some(&stored), &big, audio), Match::Different);
        assert_eq!(compare(None, &small, audio), Match::Unknown);
        assert_eq!(compare(Some(&stored), &dir.join("gone.m4a"), audio), Match::Missing);
        assert_ne!(audio(&small).unwrap(), stored);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
