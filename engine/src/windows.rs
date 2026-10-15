use crate::RATE;

const FRAME: usize = RATE / 10;
const SILENT_DB: f32 = -45.0;
const PAUSE_FRAMES: usize = 6;
const BREATH_FRAMES: usize = 2;
const MARGIN_FRAMES: usize = 2;
const SHORTEST_FRAMES: usize = 15;

pub const DEFAULT_MIN_SECONDS: f32 = 5.0;
pub const DEFAULT_MAX_SECONDS: f32 = 23.0;
pub const DENSE_MIN_SECONDS: f32 = 5.0;
pub const DENSE_MAX_SECONDS: f32 = 15.0;
pub const PROBE_MIN_SECONDS: f32 = 17.0;
pub const PROBE_MAX_SECONDS: f32 = 23.0;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Cut {
    Pause,
    Breath,
    Forced,
    End,
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
    split_explained(audio, min_seconds, max_seconds).into_iter().map(|(w, _)| w).collect()
}

/// Splits each track on its own and orders all lines by their start, so speakers take turns.
pub fn split_tracks(tracks: &[Vec<f32>], min_seconds: f32, max_seconds: f32) -> Vec<(usize, Window)> {
    let mut all: Vec<(usize, Window)> = tracks
        .iter()
        .enumerate()
        .flat_map(|(track, audio)| split(audio, min_seconds, max_seconds).into_iter().map(move |w| (track, w)))
        .collect();
    all.sort_by_key(|(track, w)| (w.start, *track));
    all
}

/// Ends a line at the first pause after `min_seconds`. Without one before `max_seconds`, at the
/// longest breath, and only failing that at the quietest moment. Silence between lines is left out.
pub fn split_explained(audio: &[f32], min_seconds: f32, max_seconds: f32) -> Vec<(Window, Cut)> {
    if audio.is_empty() {
        return Vec::new();
    }
    let frames = audio.len() / FRAME;
    let level: Vec<f32> = (0..frames)
        .map(|i| decibels(rms(&audio[i * FRAME..(i + 1) * FRAME])))
        .collect();
    let threshold = quiet_threshold(&level);
    let pauses = quiet_runs(&level, threshold, PAUSE_FRAMES);
    let breaths = quiet_runs(&level, threshold, BREATH_FRAMES);
    let min = (min_seconds * 10.0) as usize;
    let max = (max_seconds * 10.0) as usize;

    let mut cuts: Vec<(usize, usize, Cut)> = Vec::new();
    let mut start = match pauses.first() {
        Some(&(0, end)) => end.saturating_sub(MARGIN_FRAMES),
        _ => 0,
    };
    while frames.saturating_sub(start) > min {
        let lo = start + min;
        let hi = (start + max).min(frames);
        let pause = pauses
            .iter()
            .find(|&&(from, to)| to > lo && from <= hi && from >= start + SHORTEST_FRAMES);
        if let Some(&(from, to)) = pause {
            let end = from + MARGIN_FRAMES;
            cuts.push((start, end, Cut::Pause));
            start = to.saturating_sub(MARGIN_FRAMES).max(end);
            continue;
        }
        if frames - start <= max {
            break;
        }
        let breath = breaths
            .iter()
            .filter(|&&(from, to)| from >= lo && to <= hi)
            .max_by_key(|&&(from, to)| to - from);
        let (cut, reason) = match breath {
            Some(&(from, to)) => ((from + to) / 2, Cut::Breath),
            None => (lo + argmin(&level[lo..hi]), Cut::Forced),
        };
        cuts.push((start, cut, reason));
        start = cut;
    }
    if start < frames || cuts.is_empty() {
        cuts.push((start, frames, Cut::End));
    }

    let last = cuts.len() - 1;
    cuts.into_iter()
        .enumerate()
        .map(|(i, (from, to, reason))| {
            let window = Window {
                start: (from * FRAME).min(audio.len()),
                end: if i == last { audio.len() } else { (to * FRAME).min(audio.len()) },
            };
            (window, reason)
        })
        .filter(|(w, _)| w.end > w.start && decibels(rms(&audio[w.start..w.end])) > SILENT_DB)
        .collect()
}

const DIGITAL_SILENCE_DB: f32 = -70.0;

fn quiet_threshold(level: &[f32]) -> f32 {
    let mut audible: Vec<f32> = level.iter().copied().filter(|db| *db > DIGITAL_SILENCE_DB).collect();
    if audible.is_empty() {
        return DIGITAL_SILENCE_DB;
    }
    audible.sort_by(|a, b| a.total_cmp(b));
    let floor = audible[audible.len() / 20];
    let speech = audible[audible.len() * 9 / 10];
    if speech - floor < 6.0 {
        return DIGITAL_SILENCE_DB;
    }
    floor + ((speech - floor) * 0.3).max(3.0)
}

fn quiet_runs(level: &[f32], threshold: f32, shortest: usize) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    let mut run_start = None;
    for (i, db) in level.iter().chain(std::iter::once(&f32::MAX)).enumerate() {
        match (run_start, *db < threshold) {
            (None, true) => run_start = Some(i),
            (Some(from), false) => {
                if i - from >= shortest {
                    found.push((from, i));
                }
                run_start = None;
            }
            _ => {}
        }
    }
    found
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

    fn noise(seconds: f32, amplitude: f32) -> Vec<f32> {
        let n = (seconds * RATE as f32) as usize;
        let mut state = 7u32;
        (0..n)
            .map(|_| {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                amplitude * ((state >> 16) as f32 / 32_768.0 - 1.0)
            })
            .collect()
    }

    #[test]
    fn orders_the_lines_of_several_tracks_by_their_start() {
        let first = [tone(8.0), silence(10.0)].concat();
        let second = [silence(9.0), tone(7.0)].concat();
        let lines = split_tracks(&[first, second], 5.0, 23.0);
        let order: Vec<usize> = lines.iter().map(|(track, _)| *track).collect();
        assert_eq!(order, vec![0, 1]);
        assert!(seconds(lines[1].1.start) > 8.0);
        assert!(split_tracks(&[silence(5.0), tone(6.0)], 5.0, 23.0).iter().all(|(track, _)| *track == 1));
    }

    #[test]
    fn dense_scripts_get_shorter_windows() {
        assert_eq!(bounds_for("th"), (5.0, 15.0));
        assert_eq!(bounds_for("ja"), (5.0, 15.0));
        assert_eq!(bounds_for("en"), (5.0, 23.0));
        assert_eq!(bounds_for("de"), (5.0, 23.0));
    }

    #[test]
    fn empty_audio_has_no_windows() {
        assert!(split(&[], 5.0, 23.0).is_empty());
    }

    #[test]
    fn silence_has_no_windows() {
        assert!(split(&silence(40.0), 5.0, 23.0).is_empty());
    }

    #[test]
    fn short_audio_is_one_window() {
        let audio = tone(10.0);
        let windows = split(&audio, 5.0, 23.0);
        assert_eq!(windows, vec![Window { start: 0, end: audio.len() }]);
    }

    #[test]
    fn ends_a_line_at_the_first_pause_after_the_minimum() {
        let mut audio = tone(7.0);
        audio.extend(silence(1.0));
        audio.extend(tone(9.0));
        audio.extend(silence(1.0));
        audio.extend(tone(6.0));
        let windows = split(&audio, 5.0, 23.0);
        assert_eq!(windows.len(), 3, "{windows:?}");
        assert!((seconds(windows[0].end) - 7.2).abs() < 0.15, "{windows:?}");
        assert!((seconds(windows[1].start) - 7.8).abs() < 0.15, "{windows:?}");
        assert!((seconds(windows[1].end) - 17.2).abs() < 0.15, "{windows:?}");
        assert_eq!(windows[2].end, audio.len());
    }

    #[test]
    fn without_a_pause_a_long_line_ends_at_a_breath_rather_than_anywhere() {
        let mut audio = tone(9.0);
        audio.extend(silence(0.3));
        audio.extend(tone(9.0));
        let explained = split_explained(&audio, 5.0, 15.0);
        assert_eq!(explained.len(), 2, "{explained:?}");
        assert_eq!(explained[0].1, Cut::Breath);
        assert!((seconds(explained[0].0.end) - 9.1).abs() < 0.15, "{explained:?}");
        assert_eq!(explained[1].1, Cut::End);
    }

    #[test]
    fn a_short_breath_is_not_a_pause() {
        let mut audio = tone(7.0);
        audio.extend(silence(0.3));
        audio.extend(tone(7.0));
        audio.extend(silence(1.0));
        audio.extend(tone(6.0));
        let windows = split(&audio, 5.0, 23.0);
        assert_eq!(windows.len(), 2, "{windows:?}");
        assert!((seconds(windows[0].end) - 14.5).abs() < 0.15, "{windows:?}");
    }

    #[test]
    fn leaves_out_long_silences() {
        let mut audio = silence(4.0);
        audio.extend(tone(8.0));
        audio.extend(silence(30.0));
        audio.extend(tone(6.0));
        let windows = split(&audio, 5.0, 23.0);
        assert_eq!(windows.len(), 2, "{windows:?}");
        assert!((seconds(windows[0].start) - 3.8).abs() < 0.15, "{windows:?}");
        assert!((seconds(windows[0].end) - 12.2).abs() < 0.15, "{windows:?}");
        assert!((seconds(windows[1].start) - 41.8).abs() < 0.15, "{windows:?}");
    }

    #[test]
    fn finds_pauses_above_a_noise_floor() {
        let mut audio: Vec<f32> = tone(8.0).iter().zip(noise(8.0, 0.02)).map(|(t, n)| t + n).collect();
        audio.extend(noise(1.0, 0.02));
        audio.extend(tone(8.0).iter().zip(noise(8.0, 0.02)).map(|(t, n)| t + n));
        let windows = split(&audio, 5.0, 23.0);
        assert_eq!(windows.len(), 2, "{windows:?}");
        assert!((seconds(windows[0].end) - 8.2).abs() < 0.15, "{windows:?}");
    }

    #[test]
    fn falls_back_to_the_quietest_moment_when_nobody_pauses() {
        let audio = tone(120.0);
        let windows = split(&audio, 5.0, 23.0);
        assert!(windows.len() >= 6, "{windows:?}");
        assert!(split_explained(&audio, 5.0, 23.0).iter().any(|(_, cut)| *cut == Cut::Forced));
        for w in &windows {
            let length = seconds(w.end - w.start);
            assert!(length <= 23.1, "window of {length} s");
        }
        assert_eq!(windows.last().unwrap().end, audio.len());
    }

    #[test]
    fn never_drops_a_short_word_before_a_long_silence() {
        let mut audio = tone(0.8);
        audio.extend(silence(10.0));
        audio.extend(tone(9.0));
        let windows = split(&audio, 5.0, 15.0);
        assert!(windows[0].start == 0 && seconds(windows[0].end - windows[0].start) >= 1.5, "{windows:?}");
    }
}
