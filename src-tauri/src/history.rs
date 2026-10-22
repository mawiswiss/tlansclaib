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

    pub fn list(&self) -> Result<Vec<Listed>> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.load()?
            .into_iter()
            .map(|entry| Listed {
                exists: entry.file.is_file(),
                audio_exists: entry.audio.is_file(),
                entry,
            })
            .collect())
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

    pub fn get(&self, id: u64) -> Result<Option<Entry>> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.load()?.into_iter().find(|e| e.id == id))
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

    pub fn renamed(&self, from: &Path, to: &Path) -> Result<()> {
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.file == from) {
                entry.file = to.to_path_buf();
            }
            entries
        })
    }

    pub fn written(&self, file: &Path, timestamps: bool, speakers: &[String]) -> Result<()> {
        let hash = crate::fingerprint::transcript(file).ok();
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.file == file) {
                entry.timestamps = timestamps;
                entry.speakers = speakers.to_vec();
                entry.file_sha256 = hash.clone();
            }
            entries
        })
    }

    fn change(&self, f: impl FnOnce(Vec<Entry>) -> Vec<Entry>) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let before = self.load()?;
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

    fn load(&self) -> Result<Vec<Entry>> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error).context("Could not read the history file"),
        };
        match serde_json::from_str(&text) {
            Ok(entries) => Ok(entries),
            Err(error) => {
                let aside = self.path.with_extension("broken.json");
                if aside.exists() {
                    anyhow::bail!("The history file is damaged. An earlier recovery copy already exists, so the damaged file was left in place: {error}");
                }
                std::fs::rename(&self.path, &aside).context("Could not preserve the damaged history file")?;
                log::warn!("damaged history file moved aside for recovery");
                anyhow::bail!("The history file was damaged. A copy was saved as history.broken.json for recovery: {error}")
            }
        }
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
        history.written(Path::new("/a.txt"), false, &["Marc".into(), "Client".into()]).unwrap();
        history.remove(2).unwrap();
        let listed = history.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].entry.timestamps);
        assert_eq!(listed[0].entry.speakers, vec!["Marc", "Client"]);
        assert!(!listed[0].exists);

        let moved = dir.join("moved_transcript.txt");
        std::fs::write(&moved, "first line\n").unwrap();
        assert!(history.relocate(1, Kind::Transcript, &dir.join("missing.txt")).is_err());
        history.relocate(1, Kind::Transcript, &moved).unwrap();
        let listed = history.list().unwrap();
        assert_eq!(listed[0].entry.file, moved);
        assert!(listed[0].exists);
        assert!(listed[0].entry.file_sha256.is_some());

        let recording = dir.join("meeting.m4a");
        std::fs::write(&recording, b"audio").unwrap();
        history.relocate(1, Kind::Audio, &recording).unwrap();
        let entry = history.get(1).unwrap().unwrap();
        assert_eq!(entry.audio, recording);
        assert!(entry.audio_fingerprint.is_some());
        assert!(history.list().unwrap()[0].audio_exists);

        let hash = history.get(1).unwrap().unwrap().file_sha256;
        let renamed = crate::transcript::rename(&moved, "Weekly sync").unwrap();
        history.renamed(&moved, &renamed).unwrap();
        let listed = history.list().unwrap();
        assert_eq!(listed[0].entry.file, renamed);
        assert!(listed[0].exists);
        assert_eq!(listed[0].entry.file_sha256, hash);

        history.save_times(1, &[(0.0, 4.5), (5.0, 9.0)]).unwrap();
        assert_eq!(history.times(1), Some(vec![(0.0, 4.5), (5.0, 9.0)]));
        history.remove(1).unwrap();
        assert_eq!(history.times(1), None);

        std::fs::write(dir.join("history.json"), "not json").unwrap();
        assert!(history.list().is_err());
        assert!(dir.join("history.broken.json").is_file());
        assert!(history.list().unwrap().is_empty());
        std::fs::write(dir.join("history.json"), "also not json").unwrap();
        assert!(history.list().is_err());
        assert_eq!(std::fs::read_to_string(dir.join("history.broken.json")).unwrap(), "not json");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_edit_in_the_app_keeps_the_fingerprint_in_step_and_an_outside_edit_does_not() {
        use crate::fingerprint::{self, Match};
        use crate::transcript::{self, Line};

        let dir = std::env::temp_dir().join(format!("tlansclaib-edit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("meeting_transcript.txt");
        std::fs::write(&file, "[00:00:00.00 --> 00:00:12.75] first\n").unwrap();
        let history = History::new(dir.join("history.json"));
        let mut saved = entry(1, file.to_str().unwrap());
        saved.file_sha256 = Some(fingerprint::transcript(&file).unwrap());
        history.add(saved).unwrap();
        let stored = || history.get(1).unwrap().unwrap().file_sha256;

        let opened = fingerprint::transcript(&file).unwrap();
        let lines = vec![Line { start: 0.0, end: 12.75, text: "first, corrected".into(), speaker: None }];
        transcript::save(&file, &opened, &lines, true, &[]).unwrap();
        history.written(&file, true, &[]).unwrap();
        assert_eq!(fingerprint::compare(stored().as_deref(), &file, fingerprint::transcript), Match::Same);

        std::fs::write(&file, "changed in another editor\n").unwrap();
        assert_eq!(fingerprint::compare(stored().as_deref(), &file, fingerprint::transcript), Match::Different);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
