use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const LIMIT: usize = 500;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Transcript,
    Audio,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Done,
    Incomplete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Entry {
    pub id: u64,
    pub audio: PathBuf,
    pub file: PathBuf,
    pub model: String,
    pub language: Option<String>,
    pub audio_seconds: Option<f64>,
    pub lines: usize,
    pub elapsed: f64,
    pub finished_at: u64,
    pub status: Status,
    pub timestamps: bool,
    #[serde(default)]
    pub audio_fingerprint: Option<String>,
    #[serde(default)]
    pub file_sha256: Option<String>,
    #[serde(default)]
    pub speakers: Vec<String>,
    #[serde(default)]
    pub detected: bool,
    #[serde(default)]
    pub video: Option<bool>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub speaker_mode: Option<String>,
    #[serde(default)]
    pub speaker_precision: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Listed {
    #[serde(flatten)]
    pub entry: Entry,
    pub exists: bool,
    pub audio_exists: bool,
}

pub struct History {
    path: PathBuf,
    lock: Mutex<()>,
}

impl History {
    pub fn new(path: PathBuf) -> History {
        History { path, lock: Mutex::new(()) }
    }

    pub fn list(&self) -> Vec<Listed> {
        let _guard = self.lock.lock().unwrap();
        self.load()
            .into_iter()
            .map(|entry| Listed {
                exists: entry.file.is_file(),
                audio_exists: entry.audio.is_file(),
                entry,
            })
            .collect()
    }

    pub fn add(&self, entry: Entry) -> Result<()> {
        self.change(|entries| add(entries, entry))
    }

    pub fn remove(&self, id: u64) -> Result<()> {
        self.change(|mut entries| {
            entries.retain(|e| e.id != id);
            entries
        })
    }

    /// The start and end of each written line, kept beside the history so a transcript saved without
    /// timecodes can still play along.
    pub fn save_times(&self, id: u64, times: &[(f64, f64)]) -> Result<()> {
        let dir = self.times_dir();
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(times)?)?;
        Ok(())
    }

    pub fn times(&self, id: u64) -> Option<Vec<(f64, f64)>> {
        let text = std::fs::read_to_string(self.times_dir().join(format!("{id}.json"))).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn times_dir(&self) -> PathBuf {
        self.path.with_file_name("times")
    }

    pub fn get(&self, id: u64) -> Option<Entry> {
        let _guard = self.lock.lock().unwrap();
        self.load().into_iter().find(|e| e.id == id)
    }

    pub fn relocate(&self, id: u64, kind: Kind, path: &Path) -> Result<()> {
        if !path.is_file() {
            anyhow::bail!("{} is not a file", path.display());
        }
        let fingerprint = match kind {
            Kind::Transcript => crate::fingerprint::transcript(path)?,
            Kind::Audio => crate::fingerprint::audio(path)?,
        };
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.id == id) {
                match kind {
                    Kind::Transcript => {
                        entry.file = path.to_path_buf();
                        entry.file_sha256 = Some(fingerprint.clone());
                    }
                    Kind::Audio => {
                        entry.audio = path.to_path_buf();
                        entry.audio_fingerprint = Some(fingerprint.clone());
                    }
                }
            }
            entries
        })
    }

    fn change(&self, f: impl FnOnce(Vec<Entry>) -> Vec<Entry>) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let before = self.load();
        let ids: Vec<u64> = before.iter().map(|e| e.id).collect();
        let entries = f(before);
        for gone in ids.iter().filter(|id| !entries.iter().any(|e| e.id == **id)) {
            let _ = std::fs::remove_file(self.times_dir().join(format!("{gone}.json")));
        }
        let part = self.path.with_extension("json.part");
        std::fs::write(&part, serde_json::to_vec_pretty(&entries)?)
            .with_context(|| format!("cannot write {}", part.display()))?;
        std::fs::rename(&part, &self.path).with_context(|| format!("cannot write {}", self.path.display()))?;
        Ok(())
    }

    fn load(&self) -> Vec<Entry> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_else(|error| {
            let aside = self.path.with_extension("broken.json");
            log::warn!("{} is unreadable ({error}), moved it to {}", self.path.display(), aside.display());
            let _ = std::fs::rename(&self.path, &aside);
            Vec::new()
        })
    }
}

pub fn add(mut entries: Vec<Entry>, entry: Entry) -> Vec<Entry> {
    entries.retain(|e| e.file != entry.file);
    entries.insert(0, entry);
    entries.truncate(LIMIT);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, file: &str) -> Entry {
        Entry {
            id,
            audio: PathBuf::from("/recordings/meeting.m4a"),
            file: PathBuf::from(file),
            model: "Thai (fast)".into(),
            language: Some("th".into()),
            audio_seconds: Some(180.0),
            lines: 14,
            elapsed: 7.9,
            finished_at: 1_760_000_000,
            status: Status::Done,
            timestamps: true,
            audio_fingerprint: None,
            file_sha256: None,
            speakers: Vec::new(),
            detected: false,
            video: None,
            model_id: None,
            speaker_mode: None,
            speaker_precision: None,
        }
    }

    #[test]
    fn newest_first_and_a_rewritten_file_replaces_its_old_entry() {
        let entries = add(Vec::new(), entry(1, "/a.txt"));
        let entries = add(entries, entry(2, "/b.txt"));
        let entries = add(entries, entry(3, "/a.txt"));
        let ids: Vec<u64> = entries.iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![3, 2]);
    }

    #[test]
    fn keeps_a_limited_number_of_entries() {
        let mut entries = Vec::new();
        for id in 0..(LIMIT as u64 + 20) {
            entries = add(entries, entry(id, &format!("/{id}.txt")));
        }
        assert_eq!(entries.len(), LIMIT);
        assert_eq!(entries[0].id, LIMIT as u64 + 19);
    }

    #[test]
    fn stores_removes_and_survives_a_broken_file() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-history-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let history = History::new(dir.join("history.json"));
        history.add(entry(1, "/a.txt")).unwrap();
        history.add(entry(2, "/b.txt")).unwrap();
        history.remove(2).unwrap();
        let listed = history.list();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].exists);

        let moved = dir.join("moved_transcript.txt");
        std::fs::write(&moved, "first line\n").unwrap();
        assert!(history.relocate(1, Kind::Transcript, &dir.join("missing.txt")).is_err());
        history.relocate(1, Kind::Transcript, &moved).unwrap();
        let listed = history.list();
        assert_eq!(listed[0].entry.file, moved);
        assert!(listed[0].exists);
        assert!(listed[0].entry.file_sha256.is_some());

        let recording = dir.join("meeting.m4a");
        std::fs::write(&recording, b"audio").unwrap();
        history.relocate(1, Kind::Audio, &recording).unwrap();
        let entry = history.get(1).unwrap();
        assert_eq!(entry.audio, recording);
        assert!(entry.audio_fingerprint.is_some());
        assert!(history.list()[0].audio_exists);

        history.save_times(1, &[(0.0, 4.5), (5.0, 9.0)]).unwrap();
        assert_eq!(history.times(1), Some(vec![(0.0, 4.5), (5.0, 9.0)]));
        history.remove(1).unwrap();
        assert_eq!(history.times(1), None);

        std::fs::write(dir.join("history.json"), "not json").unwrap();
        assert!(history.list().is_empty());
        assert!(dir.join("history.broken.json").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
