use crate::RATE;

const FRAME: usize = RATE / 10;
const SILENT_DB: f32 = -45.0;

pub const DEFAULT_MIN_SECONDS: f32 = 17.0;
pub const DEFAULT_MAX_SECONDS: f32 = 23.0;
pub const DENSE_MIN_SECONDS: f32 = 11.0;
pub const DENSE_MAX_SECONDS: f32 = 15.0;

// Whisper's tokenizer spends up to three times more tokens per second of speech on these scripts,
// and whisper.cpp caps a segment at 220 tokens, so their windows stay short.
const DENSE_SCRIPTS: &[&str] = &["th", "zh", "ja", "ko", "my", "km", "lo"];

pub fn bounds_for(language: &str) -> (f32, f32) {
    if DENSE_SCRIPTS.contains(&language) {
        (DENSE_MIN_SECONDS, DENSE_MAX_SECONDS)
    } else {
        (DEFAULT_MIN_SECONDS, DEFAULT_MAX_SECONDS)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window {
    pub start: usize,
    pub end: usize,
}

impl Window {
    pub fn start_seconds(&self) -> f64 {
        self.start as f64 / RATE as f64
    }

    pub fn end_seconds(&self) -> f64 {
        self.end as f64 / RATE as f64
    }
}

pub fn split(audio: &[f32], min_seconds: f32, max_seconds: f32) -> Vec<Window> {
    if audio.is_empty() {
        return Vec::new();
    }
    let min = (min_seconds * RATE as f32) as usize;
    let max = (max_seconds * RATE as f32) as usize;
    let frames = audio.len() / FRAME;
    let frame_rms: Vec<f32> = (0..frames)
        .map(|i| rms(&audio[i * FRAME..(i + 1) * FRAME]))
        .collect();

    let mut windows = Vec::new();
    let mut start = 0;
    while audio.len() - start > max {
        let lo = (start + min) / FRAME;
        let hi = (start + max) / FRAME;
        let cut = (lo + argmin(&frame_rms[lo..hi])) * FRAME + FRAME / 2;
        windows.push(Window { start, end: cut });
        start = cut;
    }
    windows.push(Window {
        start,
        end: audio.len(),
    });
    windows
        .into_iter()
        .filter(|w| decibels(rms(&audio[w.start..w.end])) > SILENT_DB)
        .collect()
}

fn rms(samples: &[f32]) -> f32 {
    let energy: f32 = samples.iter().map(|s| s * s).sum();
    (energy / samples.len() as f32).sqrt()
}

fn decibels(amplitude: f32) -> f32 {
    20.0 * (amplitude + 1e-9).log10()
}

fn argmin(values: &[f32]) -> usize {
    let mut best = 0;
    for (i, v) in values.iter().enumerate() {
        if *v < values[best] {
            best = i;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32) -> Vec<f32> {
        let n = (seconds * RATE as f32) as usize;
        (0..n)
            .map(|i| 0.5 * (i as f32 * 0.1).sin())
            .collect()
    }

    fn silence(seconds: f32) -> Vec<f32> {
        vec![0.0; (seconds * RATE as f32) as usize]
    }

    fn seconds(samples: usize) -> f32 {
        samples as f32 / RATE as f32
    }

    #[test]
    fn dense_scripts_get_short_windows() {
        assert_eq!(bounds_for("th"), (11.0, 15.0));
        assert_eq!(bounds_for("ja"), (11.0, 15.0));
        assert_eq!(bounds_for("en"), (17.0, 23.0));
        assert_eq!(bounds_for("de"), (17.0, 23.0));
    }

    #[test]
    fn empty_audio_has_no_windows() {
        assert!(split(&[], 17.0, 23.0).is_empty());
    }

    #[test]
    fn silence_has_no_windows() {
        assert!(split(&silence(40.0), 17.0, 23.0).is_empty());
    }

    #[test]
    fn short_audio_is_one_window() {
        let audio = tone(10.0);
        let windows = split(&audio, 17.0, 23.0);
        assert_eq!(windows, vec![Window { start: 0, end: audio.len() }]);
    }

    #[test]
    fn cuts_at_the_quiet_gaps() {
        let mut audio = tone(20.0);
        audio.extend(silence(0.5));
        audio.extend(tone(19.5));
        audio.extend(silence(0.5));
        audio.extend(tone(19.5));
        let windows = split(&audio, 17.0, 23.0);
        assert_eq!(windows.len(), 3);
        assert!((seconds(windows[0].end) - 20.05).abs() < 0.15);
        assert!((seconds(windows[1].end) - 40.05).abs() < 0.15);
        assert_eq!(windows[2].end, audio.len());
        assert_eq!(windows[0].end, windows[1].start);
        assert_eq!(windows[1].end, windows[2].start);
    }

    #[test]
    fn drops_a_silent_window_and_keeps_the_rest() {
        let mut audio = tone(20.0);
        audio.extend(silence(25.0));
        audio.extend(tone(5.0));
        let windows = split(&audio, 17.0, 23.0);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].start, 0);
        assert_eq!(windows[1].end, audio.len());
        assert!(windows[0].end < windows[1].start);
    }

    #[test]
    fn honours_the_window_bounds() {
        let audio = tone(120.0);
        for w in split(&audio, 17.0, 23.0) {
            let length = seconds(w.end - w.start);
            assert!(length <= 23.1, "window of {length} s");
        }
    }
}
