use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::windows::Window;

pub struct Writer {
    txt_path: PathBuf,
    timestamps_path: PathBuf,
    txt: BufWriter<File>,
    timestamps: BufWriter<File>,
    lines: usize,
}

impl Writer {
    pub fn create(stem: &Path) -> Result<Writer> {
        let txt_path = PathBuf::from(format!("{}.txt", stem.display()));
        let timestamps_path = PathBuf::from(format!("{}_timestamps.txt", stem.display()));
        let txt = File::create(&txt_path)
            .with_context(|| format!("cannot write {}", txt_path.display()))?;
        let timestamps = File::create(&timestamps_path)
            .with_context(|| format!("cannot write {}", timestamps_path.display()))?;
        Ok(Writer {
            txt_path,
            timestamps_path,
            txt: BufWriter::new(txt),
            timestamps: BufWriter::new(timestamps),
            lines: 0,
        })
    }

    pub fn append(&mut self, window: &Window, text: &str) -> Result<()> {
        if text.is_empty() {
            return Ok(());
        }
        writeln!(self.txt, "{text}")?;
        writeln!(
            self.timestamps,
            "[{} --> {}] {text}",
            stamp(window.start_seconds()),
            stamp(window.end_seconds())
        )?;
        self.txt.flush()?;
        self.timestamps.flush()?;
        self.lines += 1;
        Ok(())
    }

    pub fn finish(mut self) -> Result<(usize, PathBuf, PathBuf)> {
        self.txt.flush()?;
        self.timestamps.flush()?;
        self.txt.get_ref().sync_all()?;
        self.timestamps.get_ref().sync_all()?;
        Ok((self.lines, self.txt_path, self.timestamps_path))
    }
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

    #[test]
    fn writes_both_files_and_skips_empty_text() {
        let dir = std::env::temp_dir().join(format!("tlansclaib-output-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = dir.join("meeting_transcript");
        let mut writer = Writer::create(&stem).unwrap();
        writer
            .append(&Window { start: 0, end: 16_000 * 17 }, "first line")
            .unwrap();
        writer
            .append(&Window { start: 16_000 * 17, end: 16_000 * 35 }, "")
            .unwrap();
        writer
            .append(&Window { start: 16_000 * 35, end: 16_000 * 50 }, "third line")
            .unwrap();
        let (lines, txt, timestamps) = writer.finish().unwrap();
        assert_eq!(lines, 2);
        assert_eq!(std::fs::read_to_string(&txt).unwrap(), "first line\nthird line\n");
        assert_eq!(
            std::fs::read_to_string(&timestamps).unwrap(),
            "[00:00:00.00 --> 00:00:17.00] first line\n[00:00:35.00 --> 00:00:50.00] third line\n"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
