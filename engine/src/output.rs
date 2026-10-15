use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::windows::Window;

pub struct Writer {
    path: PathBuf,
    file: BufWriter<File>,
    timestamps: bool,
    lines: usize,
}

impl Writer {
    pub fn create(path: &Path, timestamps: bool) -> Result<Writer> {
        let file = File::create(path).with_context(|| format!("cannot write {}", path.display()))?;
        Ok(Writer {
            path: path.to_path_buf(),
            file: BufWriter::new(file),
            timestamps,
            lines: 0,
        })
    }

    pub fn append(&mut self, window: &Window, speaker: Option<&str>, text: &str) -> Result<()> {
        if text.is_empty() {
            return Ok(());
        }
        self.file
            .write_all(line(window.start_seconds(), window.end_seconds(), speaker, text, self.timestamps).as_bytes())?;
        self.file.flush()?;
        self.lines += 1;
        Ok(())
    }

    pub fn finish(mut self) -> Result<(usize, PathBuf)> {
        self.file.flush()?;
        self.file.get_ref().sync_all()?;
        Ok((self.lines, self.path))
    }
}

/// One label per track, or none for a recording with a single track.
pub fn speakers(tracks: usize) -> Vec<String> {
    if tracks < 2 {
        return Vec::new();
    }
    (1..=tracks).map(|n| format!("Speaker {n}")).collect()
}

pub fn line(start: f64, end: f64, speaker: Option<&str>, text: &str, timestamps: bool) -> String {
    let text = match speaker {
        Some(speaker) => format!("{speaker}: {text}"),
        None => text.to_string(),
    };
    if timestamps {
        format!("[{} --> {}] {text}\n", stamp(start), stamp(end))
    } else {
        format!("{text}\n")
    }
}

pub fn render<'a>(lines: impl IntoIterator<Item = (f64, f64, Option<&'a str>, &'a str)>, timestamps: bool) -> String {
    lines
        .into_iter()
        .filter(|(_, _, _, text)| !text.is_empty())
        .map(|(start, end, speaker, text)| line(start, end, speaker, text, timestamps))
        .collect()
}

pub fn stamp(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor();
    let minutes = ((seconds - hours * 3600.0) / 60.0).floor();
    let rest = seconds - hours * 3600.0 - minutes * 60.0;
    format!("{:02}:{:02}:{:05.2}", hours as u32, minutes as u32, rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_match_the_script_format() {
        assert_eq!(stamp(0.0), "00:00:00.00");
        assert_eq!(stamp(17.25), "00:00:17.25");
        assert_eq!(stamp(3661.5), "01:01:01.50");
    }

    fn write(timestamps: bool) -> String {
        static RUNS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let run = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tlansclaib-output-{}-{run}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("meeting_transcript.txt");
        let mut writer = Writer::create(&path, timestamps).unwrap();
        writer.append(&Window { start: 0, end: 16_000 * 17 }, None, "first line").unwrap();
        writer.append(&Window { start: 16_000 * 17, end: 16_000 * 35 }, None, "").unwrap();
        writer.append(&Window { start: 16_000 * 35, end: 16_000 * 50 }, None, "third line").unwrap();
        let (lines, written) = writer.finish().unwrap();
        assert_eq!(lines, 2);
        assert_eq!(written, path);
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        text
    }

    #[test]
    fn puts_the_time_stamps_in_front_of_each_line_and_skips_empty_text() {
        assert_eq!(
            write(true),
            "[00:00:00.00 --> 00:00:17.00] first line\n[00:00:35.00 --> 00:00:50.00] third line\n"
        );
    }

    #[test]
    fn writes_plain_text_without_time_stamps() {
        assert_eq!(write(false), "first line\nthird line\n");
    }

    #[test]
    fn renders_what_the_writer_writes() {
        let lines = [(0.0, 17.0, None, "first line"), (17.0, 35.0, None, ""), (35.0, 50.0, None, "third line")];
        assert_eq!(render(lines, true), write(true));
        assert_eq!(render(lines, false), write(false));
    }

    #[test]
    fn names_the_speaker_of_each_line_when_there_are_several_tracks() {
        assert!(speakers(1).is_empty());
        assert_eq!(speakers(2), vec!["Speaker 1", "Speaker 2"]);
        let lines = [(0.0, 4.0, Some("Marc"), "Hello"), (4.5, 9.0, Some("Client"), "Hi there")];
        assert_eq!(
            render(lines, true),
            "[00:00:00.00 --> 00:00:04.00] Marc: Hello\n[00:00:04.50 --> 00:00:09.00] Client: Hi there\n"
        );
        assert_eq!(render(lines, false), "Marc: Hello\nClient: Hi there\n");
    }
}
