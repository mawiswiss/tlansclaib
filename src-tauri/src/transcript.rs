use std::path::Path;

use anyhow::{Context, Result, anyhow};
use engine::output::render;
use engine::words::Word;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Line {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub speaker: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<Word>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Stored {
    version: u8,
    pub entry: crate::history::Entry,
    pub lines: Vec<Line>,
}

impl Stored {
    pub fn new(entry: crate::history::Entry, lines: Vec<Line>) -> Self {
        Self { version: 1, entry, lines }
    }

    pub fn read(file: &Path) -> Result<Self> {
        let stored: Self = serde_json::from_slice(&std::fs::read(file).with_context(|| format!("cannot read {}", file.display()))?)?;
        if stored.version != 1 {
            return Err(anyhow!("This transcript uses an unsupported format version."));
        }
        Ok(stored)
    }

    pub fn write(&self, file: &Path) -> Result<()> {
        let part = file.with_extension("json.part");
        std::fs::write(&part, serde_json::to_vec(self)?).with_context(|| format!("cannot write {}", part.display()))?;
        std::fs::rename(&part, file).with_context(|| format!("cannot write {}", file.display()))?;
        Ok(())
    }
}

pub fn internal(file: &Path) -> bool {
    file.extension().is_some_and(|extension| extension == "json")
}

fn rendered(lines: &[Line], timestamps: bool, speakers: &[String]) -> String {
    let speaker = |l: &Line| l.speaker.and_then(|s| speakers.get(s)).map(String::as_str);
    render(lines.iter().map(|l| (l.start, l.end, speaker(l), l.text.as_str())), timestamps)
}

pub fn export(file: &Path, expected: &str, destination: &Path, lines: &[Line], timestamps: bool, timed: bool, speakers: &[String]) -> Result<()> {
    if destination == file {
        return Err(anyhow!("Choose a different file for the export."));
    }
    if crate::fingerprint::transcript(file)? != expected {
        return Err(anyhow!("This transcript changed since it was opened. Open it again before exporting."));
    }
    let extension = destination.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let text = match extension.as_str() {
        "txt" => rendered(lines, timestamps, speakers),
        "srt" | "vtt" if timed => subtitles(lines, speakers, extension == "vtt"),
        "srt" | "vtt" => return Err(anyhow!("This transcript has no line timing for subtitles.")),
        _ => return Err(anyhow!("Choose a .txt, .srt, or .vtt file.")),
    };
    std::fs::write(destination, text).with_context(|| format!("cannot write {}", destination.display()))
}

fn subtitles(lines: &[Line], speakers: &[String], vtt: bool) -> String {
    let mut text = if vtt { "WEBVTT\n\n".to_string() } else { String::new() };
    for (index, line) in lines.iter().filter(|line| !line.text.is_empty()).enumerate() {
        if !vtt {
            text.push_str(&format!("{}\n", index + 1));
        }
        let separator = if vtt { '.' } else { ',' };
        let time = |seconds: f64| {
            let millis = (seconds.max(0.0) * 1000.0).round() as u64;
            format!("{:02}:{:02}:{:02}{separator}{:03}", millis / 3_600_000, millis / 60_000 % 60, millis / 1000 % 60, millis % 1000)
        };
        text.push_str(&format!("{} --> {}\n", time(line.start), time(line.end)));
        if let Some(name) = line.speaker.and_then(|speaker| speakers.get(speaker)) {
            text.push_str(name);
            text.push_str(": ");
        }
        text.push_str(&line.text);
        text.push_str("\n\n");
    }
    text
}

pub fn check_speakers(speakers: &[String]) -> Result<()> {
    for (i, name) in speakers.iter().enumerate() {
        if name.trim().is_empty() || name.trim() != name {
            return Err(anyhow!("A speaker name cannot be empty or start or end with a space."));
        }
        if name.chars().count() > 40 {
            return Err(anyhow!("Keep a speaker name under 40 characters."));
        }
        if name.contains(':') || name.chars().any(char::is_control) {
            return Err(anyhow!("A speaker name cannot contain a colon, because the colon ends the name in the transcript."));
        }
        if speakers[..i].iter().any(|other| other.to_lowercase() == name.to_lowercase()) {
            return Err(anyhow!("Two speakers cannot both be called {name}."));
        }
    }
    Ok(())
}

pub fn set_timestamps(file: &Path, lines: &[Line], timestamps: bool, speakers: &[String]) -> Result<()> {
    if internal(file) {
        let mut stored = Stored::read(file)?;
        stored.entry.timestamps = timestamps;
        return stored.write(file);
    }
    let current = std::fs::read_to_string(file).with_context(|| format!("cannot read {}", file.display()))?;
    let wanted = rendered(lines, timestamps, speakers);
    if current == wanted {
        return Ok(());
    }
    if current != rendered(lines, !timestamps, speakers) {
        return Err(anyhow!(
            "{} was changed after the transcription, so it was left as it is.",
            file.display()
        ));
    }
    write(file, &wanted)
}

pub fn save(file: &Path, expected: &str, lines: &[Line], timestamps: bool, speakers: &[String], colors: &[u8]) -> Result<String> {
    check_speakers(speakers)?;
    if !colors.is_empty() && colors.len() != speakers.len() {
        return Err(anyhow!("Each speaker needs one colour."));
    }
    if lines.iter().any(|line| line.speaker.is_some_and(|speaker| speaker >= speakers.len())) {
        return Err(anyhow!("A line names a speaker that is not in the list."));
    }
    let current = crate::fingerprint::transcript(file).with_context(|| format!("cannot read {}", file.display()))?;
    if current != expected {
        return Err(anyhow!(
            "{} was changed outside tlansclaib since it was opened, so the edit was not saved. Open it again from History to see the current text.",
            file.display()
        ));
    }
    if internal(file) {
        let mut stored = Stored::read(file)?;
        stored.lines = lines.to_vec();
        stored.entry.lines = lines.iter().filter(|line| !line.text.is_empty()).count();
        stored.entry.timestamps = timestamps;
        stored.entry.set_speakers(speakers);
        stored.entry.speaker_colors = colors.to_vec();
        stored.write(file)?;
        return crate::fingerprint::transcript(file);
    }
    write(file, &rendered(lines, timestamps, speakers))?;
    crate::fingerprint::transcript(file)
}

pub const SUFFIX: &str = "_transcript.txt";

pub fn rename(file: &Path, title: &str) -> Result<std::path::PathBuf> {
    let title = title.trim().trim_matches(['.', ' ']);
    if title.is_empty() {
        return Err(anyhow!("The title cannot be empty."));
    }
    if title.chars().count() > 120 {
        return Err(anyhow!("The title is too long. Keep it under 120 characters."));
    }
    if let Some(c) = title.chars().find(|c| r#"<>:"/\|?*"#.contains(*c) || c.is_control()) {
        return Err(anyhow!("The title cannot contain {c:?}, because file names cannot."));
    }
    if !file.is_file() {
        return Err(anyhow!("The transcript is no longer at {}.", file.display()));
    }
    if internal(file) {
        let mut stored = Stored::read(file)?;
        stored.entry.title = Some(title.to_string());
        stored.write(file)?;
        return Ok(file.to_path_buf());
    }
    let target = file.with_file_name(format!("{title}{SUFFIX}"));
    if target == file {
        return Ok(target);
    }
    if target.exists() && !same_file(file, &target) {
        return Err(anyhow!("{} already exists in this folder.", target.file_name().unwrap_or_default().to_string_lossy()));
    }
    std::fs::rename(file, &target).with_context(|| format!("cannot rename {}", file.display()))?;
    Ok(target)
}

#[cfg(unix)]
fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_file(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

fn write(file: &Path, text: &str) -> Result<()> {
    let part = file.with_extension("txt.part");
    std::fs::write(&part, text).with_context(|| format!("cannot write {}", part.display()))?;
    std::fs::rename(&part, file).with_context(|| format!("cannot write {}", file.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines() -> Vec<Line> {
        vec![
            Line { start: 0.0, end: 12.75, text: "first".into(), speaker: None, words: Vec::new() },
            Line { start: 12.75, end: 24.35, text: String::new(), speaker: None, words: Vec::new() },
            Line { start: 24.35, end: 39.25, text: "second".into(), speaker: None, words: Vec::new() },
        ]
    }

    #[test]
    fn switches_the_file_between_both_forms_and_leaves_edited_files_alone() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-transcript-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("meeting_transcript.txt");
        std::fs::write(&file, "[00:00:00.00 --> 00:00:12.75] first\n[00:00:24.35 --> 00:00:39.25] second\n").unwrap();

        set_timestamps(&file, &lines(), false, &[]).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "first\nsecond\n");
        set_timestamps(&file, &lines(), false, &[]).unwrap();
        set_timestamps(&file, &lines(), true, &[]).unwrap();
        assert!(std::fs::read_to_string(&file).unwrap().starts_with("[00:00:00.00 --> 00:00:12.75] first"));

        std::fs::write(&file, "edited by hand\n").unwrap();
        let refused = set_timestamps(&file, &lines(), false, &[]).unwrap_err().to_string();
        assert!(refused.contains("was changed after the transcription"), "{refused}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "edited by hand\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_each_line_after_its_speaker_and_renames_speakers_through_a_save() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-speakers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("call_transcript.txt");
        std::fs::write(&file, "[00:00:00.00 --> 00:00:04.00] Speaker 1: Hello\n[00:00:04.50 --> 00:00:09.00] Speaker 2: Hi\n").unwrap();
        let lines = vec![
            Line { start: 0.0, end: 4.0, text: "Hello".into(), speaker: Some(0), words: Vec::new() },
            Line { start: 4.5, end: 9.0, text: "Hi".into(), speaker: Some(1), words: Vec::new() },
        ];
        let defaults = engine::output::speakers(2);
        set_timestamps(&file, &lines, false, &defaults).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "Speaker 1: Hello\nSpeaker 2: Hi\n");

        let named = vec!["Marc".to_string(), "Client".to_string()];
        let hash = crate::fingerprint::transcript(&file).unwrap();
        save(&file, &hash, &lines, false, &named, &[]).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "Marc: Hello\nClient: Hi\n");

        let hash = crate::fingerprint::transcript(&file).unwrap();
        for bad in [vec!["Marc".to_string(), "marc".to_string()], vec!["Dr: X".to_string()], vec![" ".to_string()]] {
            assert!(save(&file, &hash, &lines, false, &bad, &[]).is_err(), "{bad:?}");
        }
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "Marc: Hello\nClient: Hi\n");

        let split = vec![
            Line { start: 0.0, end: 2.0, text: "Hel".into(), speaker: Some(0), words: Vec::new() },
            Line { start: 2.0, end: 4.0, text: "lo".into(), speaker: Some(2), words: Vec::new() },
            Line { start: 4.5, end: 9.0, text: "Hi".into(), speaker: Some(1), words: Vec::new() },
        ];
        let three = vec!["Marc".to_string(), "Client".to_string(), "Guest".to_string()];
        assert!(save(&file, &hash, &split, false, &named, &[]).unwrap_err().to_string().contains("not in the list"));
        save(&file, &hash, &split, false, &three, &[]).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "Marc: Hel\nGuest: lo\nClient: Hi\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn renames_the_file_after_the_title_and_refuses_bad_names_and_overwrites() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-rename-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("team call_transcript.txt");
        std::fs::write(&file, "text\n").unwrap();

        let renamed = rename(&file, "  Weekly sync. ").unwrap();
        assert_eq!(renamed, dir.join("Weekly sync_transcript.txt"));
        assert!(renamed.is_file() && !file.exists());
        assert_eq!(rename(&renamed, "Weekly sync").unwrap(), renamed);
        let lower = rename(&renamed, "weekly sync").unwrap();
        assert_eq!(lower.file_name().unwrap(), "weekly sync_transcript.txt");
        let renamed = rename(&lower, "Weekly sync").unwrap();

        assert!(rename(&renamed, "").is_err());
        assert!(rename(&renamed, "a/b").unwrap_err().to_string().contains("cannot contain"));
        std::fs::write(dir.join("Other_transcript.txt"), "x\n").unwrap();
        assert!(rename(&renamed, "Other").unwrap_err().to_string().contains("already exists"));
        assert!(renamed.is_file());
        assert!(rename(&dir.join("gone_transcript.txt"), "x").unwrap_err().to_string().contains("no longer"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn saves_an_edit_only_over_the_version_it_started_from() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("meeting_transcript.txt");
        std::fs::write(&file, "[00:00:00.00 --> 00:00:12.75] first\n[00:00:24.35 --> 00:00:39.25] second\n").unwrap();
        let opened = crate::fingerprint::transcript(&file).unwrap();

        let mut edited = lines();
        edited[0].text = "first, corrected".into();
        let saved = save(&file, &opened, &edited, true, &[], &[]).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "[00:00:00.00 --> 00:00:12.75] first, corrected\n[00:00:24.35 --> 00:00:39.25] second\n"
        );
        assert_eq!(saved, crate::fingerprint::transcript(&file).unwrap());

        let refused = save(&file, &opened, &lines(), true, &[], &[]).unwrap_err().to_string();
        assert!(refused.contains("changed outside"), "{refused}");
        assert!(std::fs::read_to_string(&file).unwrap().contains("corrected"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
