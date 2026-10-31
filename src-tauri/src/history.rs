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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speaker_colors: Vec<u8>,
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
    #[serde(default)]
    pub speaker_backend: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub heard: Vec<engine::protocol::Heard>,
    #[serde(default)]
    pub edited: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracks: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timings: Option<engine::protocol::Timings>,
}

impl Entry {
    pub fn set_speakers(&mut self, speakers: &[String]) {
        if self.tracks.is_none() && !self.detected && speakers.len() != self.speakers.len() {
            self.tracks = Some(self.speakers.len().max(1));
        }
        self.speakers = speakers.to_vec();
    }
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

    pub fn recover(&self) -> Result<()> {
        let dir = self.path.with_file_name("transcripts");
        if !dir.is_dir() {
            return Ok(());
        }
        let existing = match self.load() {
            Ok(entries) => entries,
            Err(_) if !self.path.exists() => Vec::new(),
            Err(error) => return Err(error),
        };
        let mut found = Vec::new();
        for file in std::fs::read_dir(dir)? {
            let path = file?.path();
            if !crate::transcript::internal(&path) {
                continue;
            }
            let Ok(mut stored) = crate::transcript::Stored::read(&path) else {
                continue;
            };
            if path.file_stem().and_then(|stem| stem.to_str()).and_then(|stem| stem.parse::<u64>().ok()) != Some(stored.entry.id) {
                continue;
            }
            if existing.iter().any(|entry| entry.id == stored.entry.id && entry.file == path) {
                continue;
            }
            if stored.entry.file != path {
                stored.entry.file = path.clone();
                stored.write(&path)?;
            }
            let mut entry = stored.entry;
            entry.file = path;
            entry.file_sha256 = Some(crate::fingerprint::transcript(&entry.file)?);
            found.push(entry);
        }
        if found.is_empty() {
            return Ok(());
        }
        found.sort_by_key(|entry| entry.finished_at);
        self.change(|mut entries| {
            for entry in found {
                entries = add(entries, entry);
            }
            entries
        })
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

    pub fn by_file(&self, file: &Path) -> Result<Option<Entry>> {
        let _guard = self.lock.lock().unwrap();
        Ok(self.load()?.into_iter().find(|entry| entry.file == file))
    }

    pub fn relocate(&self, id: u64, kind: Kind, path: &Path) -> Result<()> {
        if !path.is_file() {
            anyhow::bail!("{} is not a file", path.display());
        }
        let previous = self.get(id)?.ok_or_else(|| anyhow::anyhow!("This transcript is no longer in the history."))?;
        if kind == Kind::Transcript && crate::transcript::internal(&previous.file) {
            anyhow::bail!("An app history transcript cannot be relocated. Transcribe the recording again if its data is missing.");
        }
        if kind == Kind::Transcript && crate::transcript::internal(path) {
            anyhow::bail!("Choose a text transcript.");
        }
        let fingerprint = match kind {
            Kind::Transcript => crate::fingerprint::transcript(path)?,
            Kind::Audio => crate::fingerprint::audio(path)?,
        };
        let stored_file = (kind == Kind::Audio && crate::transcript::internal(&previous.file)).then_some(previous.file.as_path());
        let old_stored = stored_file.map(crate::transcript::Stored::read).transpose()?;
        if let (Some(file), Some(mut stored)) = (stored_file, old_stored.clone()) {
            stored.entry.audio = path.to_path_buf();
            stored.entry.audio_fingerprint = Some(fingerprint.clone());
            stored.write(file)?;
        }
        let stored_hash = stored_file.map(crate::fingerprint::transcript).transpose()?;
        let changed = self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.id == id) {
                match kind {
                    Kind::Transcript => {
                        entry.file = path.to_path_buf();
                        entry.file_sha256 = stored_hash.clone().or_else(|| Some(fingerprint.clone()));
                    }
                    Kind::Audio => {
                        entry.audio = path.to_path_buf();
                        entry.audio_fingerprint = Some(fingerprint.clone());
                        if let Some(hash) = &stored_hash {
                            entry.file_sha256 = Some(hash.clone());
                        }
                    }
                }
            }
            entries
        });
        if changed.is_err() && let (Some(file), Some(stored)) = (stored_file, old_stored) {
            let _ = stored.write(file);
        }
        changed
    }

    pub fn renamed(&self, from: &Path, to: &Path) -> Result<()> {
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.file == from) {
                entry.file = to.to_path_buf();
            }
            entries
        })
    }

    pub fn titled(&self, file: &Path, title: &str) -> Result<()> {
        let hash = crate::fingerprint::transcript(file)?;
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|entry| entry.file == file) {
                entry.title = Some(title.to_string());
                entry.file_sha256 = Some(hash.clone());
            }
            entries
        })
    }

    pub fn written(&self, file: &Path, timestamps: bool, speakers: &[String], colors: Option<&[u8]>, edited: bool) -> Result<()> {
        let hash = crate::fingerprint::transcript(file).ok();
        self.change(|mut entries| {
            for entry in entries.iter_mut().filter(|e| e.file == file) {
                if edited {
                    entry.edited = Some(true);
                }
                entry.timestamps = timestamps;
                entry.set_speakers(speakers);
                if let Some(colors) = colors {
                    entry.speaker_colors = colors.to_vec();
                }
                entry.file_sha256 = hash.clone();
            }
            entries
        })
    }

    fn change(&self, f: impl FnOnce(Vec<Entry>) -> Vec<Entry>) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let before = self.load()?;
        let entries = f(before.clone());
        let part = self.path.with_extension("json.part");
        std::fs::write(&part, serde_json::to_vec_pretty(&entries)?)
            .with_context(|| format!("cannot write {}", part.display()))?;
        std::fs::rename(&part, &self.path).with_context(|| format!("cannot write {}", self.path.display()))?;
        let transcripts = self.path.with_file_name("transcripts");
        for gone in before.iter().filter(|entry| !entries.iter().any(|next| next.id == entry.id)) {
            let _ = std::fs::remove_file(self.times_dir().join(format!("{}.json", gone.id)));
            if gone.file.parent() == Some(transcripts.as_path()) && !entries.iter().any(|entry| entry.file == gone.file) {
                let _ = std::fs::remove_file(&gone.file);
            }
        }
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
    entries.retain(|e| e.id != entry.id && e.file != entry.file);
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
            model: "Thai Compact".into(),
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
            speaker_colors: Vec::new(),
            detected: false,
            video: None,
            model_id: None,
            speaker_mode: None,
            speaker_precision: None,
            speaker_backend: None,
            title: None,
            heard: Vec::new(),
            edited: Some(false),
            tracks: None,
            device: None,
            timings: None,
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
    fn reads_an_entry_saved_before_speaker_colours() {
        let mut saved = serde_json::to_value(entry(1, "/a.txt")).unwrap();
        saved.as_object_mut().unwrap().remove("speaker_colors");
        let read: Entry = serde_json::from_value(saved).unwrap();
        assert!(read.speaker_colors.is_empty());
    }

    #[test]
    fn stores_removes_and_survives_a_broken_file() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-history-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let history = History::new(dir.join("history.json"));
        history.add(entry(1, "/a.txt")).unwrap();
        history.add(entry(2, "/b.txt")).unwrap();
        history.written(Path::new("/a.txt"), false, &["Marc".into(), "Client".into()], Some(&[1, 0]), true).unwrap();
        history.remove(2).unwrap();
        let listed = history.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].entry.timestamps);
        assert_eq!(listed[0].entry.speakers, vec!["Marc", "Client"]);
        assert_eq!(listed[0].entry.speaker_colors, vec![1, 0]);
        assert_eq!(listed[0].entry.tracks, Some(1));
        history.written(Path::new("/a.txt"), false, &["Marc".into(), "Client".into(), "Guest".into()], None, true).unwrap();
        assert_eq!(history.get(1).unwrap().unwrap().tracks, Some(1));
        assert_eq!(history.get(1).unwrap().unwrap().speaker_colors, vec![1, 0]);
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

        std::fs::create_dir_all(history.times_dir()).unwrap();
        std::fs::write(history.times_dir().join("1.json"), "[[0.0,4.5],[5.0,9.0]]").unwrap();
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
        let lines = vec![Line { start: 0.0, end: 12.75, text: "first, corrected".into(), speaker: None, words: Vec::new() }];
        transcript::save(&file, &opened, &lines, true, &[], &[]).unwrap();
        history.written(&file, true, &[], Some(&[]), true).unwrap();
        assert_eq!(fingerprint::compare(stored().as_deref(), &file, fingerprint::transcript), Match::Same);
        history.written(&file, false, &[], None, false).unwrap();
        assert_eq!(history.get(1).unwrap().unwrap().edited, Some(true));

        std::fs::write(&file, "changed in another editor\n").unwrap();
        assert_eq!(fingerprint::compare(stored().as_deref(), &file, fingerprint::transcript), Match::Different);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app_record_keeps_metadata_lines_and_exports_until_deleted() {
        use crate::transcript::{self, Line, Stored};
        use engine::words::Word;

        let dir = std::env::temp_dir().join(format!("tlansclaib-record-{}", std::process::id()));
        let records = dir.join("transcripts");
        std::fs::create_dir_all(&records).unwrap();
        let file = records.join("1.json");
        let history = History::new(dir.join("history.json"));
        let mut metadata = entry(1, file.to_str().unwrap());
        metadata.title = Some("Meeting".into());
        metadata.speakers = vec!["Speaker 1".into()];
        let words = vec![Word { start: 1.25, end: 2.0, text: "Hello".into() }, Word { start: 2.0, end: 3.5, text: "there".into() }];
        let lines = vec![Line { start: 1.25, end: 3.5, text: "Hello".into(), speaker: Some(0), words: words.clone() }];
        Stored::new(metadata.clone(), lines.clone()).write(&file).unwrap();
        metadata.file_sha256 = Some(crate::fingerprint::transcript(&file).unwrap());
        history.add(metadata).unwrap();

        let edited = vec![Line { text: "Hello there".into(), ..lines[0].clone() }];
        let hash = crate::fingerprint::transcript(&file).unwrap();
        let new_hash = transcript::save(&file, &hash, &edited, false, &["Host".into()], &[3]).unwrap();
        history.written(&file, false, &["Host".into()], Some(&[3]), true).unwrap();
        assert_eq!(history.get(1).unwrap().unwrap().file_sha256.as_deref(), Some(new_hash.as_str()));
        transcript::rename(&file, "Weekly sync").unwrap();
        history.titled(&file, "Weekly sync").unwrap();
        let stored = Stored::read(&file).unwrap();
        assert_eq!(stored.entry.title.as_deref(), Some("Weekly sync"));
        assert_eq!(stored.entry.audio, PathBuf::from("/recordings/meeting.m4a"));
        assert!(!stored.entry.timestamps);
        assert_eq!(stored.entry.speakers, vec!["Host"]);
        assert_eq!(stored.lines[0].text, "Hello there");
        assert_eq!(stored.lines[0].words, words);

        let hash = crate::fingerprint::transcript(&file).unwrap();
        let srt = dir.join("export.srt");
        transcript::export(&file, &hash, &srt, &stored.lines, false, true, &stored.entry.speakers).unwrap();
        assert_eq!(std::fs::read_to_string(&srt).unwrap(), "1\n00:00:01,250 --> 00:00:03,500\nHost: Hello there\n\n");
        let vtt = dir.join("export.vtt");
        transcript::export(&file, &hash, &vtt, &stored.lines, false, true, &stored.entry.speakers).unwrap();
        assert_eq!(std::fs::read_to_string(&vtt).unwrap(), "WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHost: Hello there\n\n");
        assert!(transcript::export(&file, &hash, &vtt, &stored.lines, false, false, &stored.entry.speakers).is_err());
        let txt = dir.join("export.txt");
        transcript::export(&file, &hash, &txt, &stored.lines, false, true, &stored.entry.speakers).unwrap();
        assert_eq!(std::fs::read_to_string(&txt).unwrap(), "Host: Hello there\n");
        let audio = dir.join("relocated.m4a");
        std::fs::write(&audio, b"recording").unwrap();
        history.relocate(1, Kind::Audio, &audio).unwrap();
        assert_eq!(Stored::read(&file).unwrap().entry.audio, audio);
        std::fs::write(dir.join("history.json"), "broken").unwrap();
        history.recover().unwrap();
        assert_eq!(history.get(1).unwrap().unwrap().title.as_deref(), Some("Weekly sync"));
        assert_eq!(Stored::read(&file).unwrap().lines[0].text, "Hello there");
        history.remove(1).unwrap();
        assert!(!file.exists());
        assert!(txt.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
