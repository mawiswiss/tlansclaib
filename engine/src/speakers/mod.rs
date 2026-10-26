#[cfg(feature = "whisper")]
use std::path::Path;

#[cfg(feature = "whisper")]
use anyhow::{Context, Result};
#[cfg(feature = "whisper")]
use libloading::Library;

use crate::RATE;
use crate::windows::Window;

pub mod nemotron;
pub mod sherpa;

const SHORTEST_PART_SECONDS: f64 = 0.3;
/// A transcript names at most this many speakers, one per colour in the app.
pub const MAX_SPEAKERS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    pub start: f64,
    pub end: f64,
    pub speaker: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Sherpa,
    Nemotron,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Sherpa => "sherpa",
            Backend::Nemotron => "nemotron",
        }
    }
}

impl std::str::FromStr for Backend {
    type Err = String;

    fn from_str(text: &str) -> Result<Backend, String> {
        match text {
            "sherpa" => Ok(Backend::Sherpa),
            "nemotron" => Ok(Backend::Nemotron),
            _ => Err(format!("unknown speaker detection {text}, expected sherpa or nemotron")),
        }
    }
}

#[cfg(feature = "whisper")]
pub enum Detection<'a> {
    Sherpa(sherpa::Detection<'a>),
    Nemotron(nemotron::Detection<'a>),
}

/// Speakers are numbered in order of their first turn.
#[cfg(feature = "whisper")]
pub fn detect(audio: &[f32], detection: &Detection, progress: impl FnMut(usize, usize)) -> Result<Vec<Turn>> {
    match detection {
        Detection::Sherpa(detection) => sherpa::detect(audio, detection, progress),
        Detection::Nemotron(detection) => nemotron::detect(audio, detection, progress),
    }
}

/// Opens the backend's library as a run does, so a part missing on this computer shows before a recording waits on it.
#[cfg(feature = "whisper")]
pub fn check(backend: Backend, folder: &Path) -> Result<()> {
    match backend {
        Backend::Sherpa => sherpa::check(folder),
        Backend::Nemotron => nemotron::check(folder),
    }
}

#[cfg(feature = "whisper")]
fn open(path: &Path) -> Result<Library> {
    // The library's own folder first, then the engine's, where the Windows installer puts the Microsoft C++ runtime.
    #[cfg(windows)]
    let library = unsafe {
        use libloading::os::windows::{LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR};
        libloading::os::windows::Library::load_with_flags(path, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS).map(Library::from)
    };
    #[cfg(not(windows))]
    let library = unsafe { Library::new(path) };
    library.context("speaker detection could not start on this computer")
}

/// Keeps the most active speakers and gives the turns of the rest to the nearest of them.
#[cfg(feature = "whisper")]
fn limit_speakers(turns: Vec<Turn>, count: usize) -> Vec<Turn> {
    let found = turns.iter().map(|t| t.speaker + 1).max().unwrap_or(0);
    if found <= count {
        return turns;
    }
    let mut ranked: Vec<(usize, f64)> = (0..found)
        .map(|speaker| (speaker, turns.iter().filter(|t| t.speaker == speaker).map(|t| t.end - t.start).sum()))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let kept: Vec<usize> = ranked.into_iter().take(count).map(|(speaker, _)| speaker).collect();
    let major: Vec<Turn> = turns.iter().copied().filter(|t| kept.contains(&t.speaker)).collect();
    renumber(
        turns
            .iter()
            .map(|t| {
                let speaker = if kept.contains(&t.speaker) { t.speaker } else { nearest(&major, (t.start + t.end) / 2.0) };
                (t.start, t.end, speaker as i32)
            })
            .collect(),
    )
}

#[cfg(feature = "whisper")]
fn renumber(turns: Vec<(f64, f64, i32)>) -> Vec<Turn> {
    let mut order: Vec<i32> = Vec::new();
    turns
        .into_iter()
        .filter(|(start, end, _)| end > start)
        .map(|(start, end, cluster)| {
            let speaker = order.iter().position(|c| *c == cluster).unwrap_or_else(|| {
                order.push(cluster);
                order.len() - 1
            });
            Turn { start, end, speaker }
        })
        .collect()
}

/// Turns without overlap. A reply of 2 s or less keeps its span, otherwise the earlier speaker keeps the floor.
fn timeline(turns: &[Turn]) -> Vec<Turn> {
    let mut edges: Vec<f64> = turns.iter().flat_map(|turn| [turn.start, turn.end]).collect();
    edges.sort_by(f64::total_cmp);
    edges.dedup();
    let mut flat: Vec<Turn> = Vec::new();
    for pair in edges.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let Some(chosen) = turns
            .iter()
            .filter(|t| t.start < end && t.end > start)
            .min_by(|a, b| ((a.end - a.start) > 2.0).cmp(&((b.end - b.start) > 2.0)).then_with(|| a.start.total_cmp(&b.start)))
        else {
            continue;
        };
        match flat.last_mut() {
            Some(last) if last.speaker == chosen.speaker && start - last.end < 0.5 => last.end = end,
            _ => flat.push(Turn { start, end, speaker: chosen.speaker }),
        }
    }
    flat
}

/// Gives each line a speaker, and cuts a line where the speaker changes inside it.
pub fn attribute(lines: &[Window], turns: &[Turn]) -> Vec<(Window, usize)> {
    let flat = timeline(turns);
    let mut out = Vec::new();
    for window in lines {
        let (from, to) = (window.start_seconds(), window.end_seconds());
        let mut parts: Vec<Turn> = Vec::new();
        for turn in flat.iter().filter(|t| t.end > from && t.start < to) {
            let piece = Turn { start: turn.start.max(from), end: turn.end.min(to), speaker: turn.speaker };
            match parts.last_mut() {
                Some(last) if last.speaker == piece.speaker => last.end = piece.end,
                _ => parts.push(piece),
            }
        }
        if parts.is_empty() {
            out.push((*window, nearest(&flat, (from + to) / 2.0)));
            continue;
        }
        for i in 1..parts.len() {
            let middle = (parts[i - 1].end + parts[i].start) / 2.0;
            parts[i - 1].end = middle;
            parts[i].start = middle;
        }
        parts[0].start = from;
        parts.last_mut().unwrap().end = to;
        while let Some(i) = parts.iter().position(|p| p.end - p.start < SHORTEST_PART_SECONDS).filter(|_| parts.len() > 1) {
            let length = |p: &Turn| p.end - p.start;
            let into = if i == 0 || (i + 1 < parts.len() && length(&parts[i + 1]) > length(&parts[i - 1])) {
                i + 1
            } else {
                i - 1
            };
            let gone = parts.remove(i);
            let target = if into > i { into - 1 } else { into };
            parts[target].start = parts[target].start.min(gone.start);
            parts[target].end = parts[target].end.max(gone.end);
            if target > 0 && parts[target - 1].speaker == parts[target].speaker {
                let merged = parts.remove(target);
                parts[target - 1].end = merged.end;
            } else if target + 1 < parts.len() && parts[target + 1].speaker == parts[target].speaker {
                let merged = parts.remove(target + 1);
                parts[target].end = merged.end;
            }
        }
        let last = parts.len() - 1;
        for (i, part) in parts.iter().enumerate() {
            let start = if i == 0 { window.start } else { (part.start * RATE as f64).round() as usize };
            let end = if i == last { window.end } else { (part.end * RATE as f64).round() as usize };
            out.push((Window { start, end }, part.speaker));
        }
    }
    let mut order: Vec<usize> = Vec::new();
    for (_, speaker) in &out {
        if !order.contains(speaker) {
            order.push(*speaker);
        }
    }
    out.into_iter()
        .map(|(w, s)| (w, order.iter().position(|o| *o == s).unwrap()))
        .collect()
}

fn nearest(flat: &[Turn], at: f64) -> usize {
    flat.iter()
        .min_by(|a, b| distance(a, at).total_cmp(&distance(b, at)))
        .map(|t| t.speaker)
        .unwrap_or(0)
}

fn distance(turn: &Turn, at: f64) -> f64 {
    if at < turn.start {
        turn.start - at
    } else if at > turn.end {
        at - turn.end
    } else {
        0.0
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn window(from: f64, to: f64) -> Window {
        Window { start: (from * RATE as f64) as usize, end: (to * RATE as f64) as usize }
    }

    pub(crate) fn turn(start: f64, end: f64, speaker: usize) -> Turn {
        Turn { start, end, speaker }
    }

    fn seconds(lines: &[(Window, usize)]) -> Vec<(f64, f64, usize)> {
        lines.iter().map(|(w, s)| (w.start_seconds(), w.end_seconds(), *s)).collect()
    }

    #[test]
    fn names_the_backends_on_the_command_line() {
        assert_eq!("sherpa".parse(), Ok(Backend::Sherpa));
        assert_eq!("nemotron".parse::<Backend>().map(Backend::as_str), Ok("nemotron"));
        assert!("pyannote".parse::<Backend>().is_err());
    }

    #[test]
    #[cfg(feature = "whisper")]
    fn numbers_speakers_by_their_first_turn() {
        let turns = renumber(vec![(0.0, 2.0, 7), (2.5, 4.0, 3), (4.5, 6.0, 7), (6.0, 6.0, 9)]);
        assert_eq!(turns.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 1, 0]);
    }

    #[test]
    fn keeps_a_line_whole_when_one_person_speaks() {
        let lines = attribute(&[window(0.0, 8.0)], &[turn(0.2, 7.5, 0)]);
        assert_eq!(seconds(&lines), vec![(0.0, 8.0, 0)]);
    }

    #[test]
    fn cuts_a_line_where_the_speaker_changes() {
        let lines = attribute(&[window(10.0, 20.0)], &[turn(9.0, 14.0, 1), turn(14.4, 21.0, 0)]);
        assert_eq!(seconds(&lines), vec![(10.0, 14.2, 0), (14.2, 20.0, 1)]);
    }

    #[test]
    fn keeps_a_short_reply_as_its_own_line() {
        let lines = attribute(&[window(0.0, 12.0)], &[turn(0.0, 5.0, 0), turn(5.0, 5.6, 1), turn(5.6, 12.0, 0)]);
        assert_eq!(seconds(&lines), vec![(0.0, 5.0, 0), (5.0, 5.6, 1), (5.6, 12.0, 0)]);
    }

    #[test]
    fn folds_a_short_piece_at_a_window_edge() {
        let lines = attribute(&[window(0.0, 5.0)], &[turn(0.0, 4.8, 0), turn(4.8, 7.0, 1)]);
        assert_eq!(seconds(&lines), vec![(0.0, 5.0, 0)]);
    }

    #[test]
    fn a_short_reply_keeps_its_full_span_in_an_overlap() {
        let flat = timeline(&[turn(0.0, 6.0, 0), turn(4.0, 9.0, 1), turn(5.0, 5.5, 2)]);
        assert_eq!(flat, vec![turn(0.0, 5.0, 0), turn(5.0, 5.5, 2), turn(5.5, 6.0, 0), turn(6.0, 9.0, 1)]);
    }

    #[test]
    fn cuts_a_line_around_a_short_reply_even_when_the_other_voice_overlaps() {
        let lines = attribute(&[window(0.0, 10.0)], &[turn(0.0, 5.0, 0), turn(4.0, 5.0, 1), turn(4.5, 10.0, 0)]);
        assert_eq!(seconds(&lines), vec![(0.0, 4.0, 0), (4.0, 5.0, 1), (5.0, 10.0, 0)]);
    }

    #[test]
    fn a_line_outside_every_turn_takes_the_nearest_speaker() {
        let lines = attribute(&[window(0.0, 3.0), window(30.0, 34.0)], &[turn(5.0, 9.0, 0), turn(20.0, 25.0, 1)]);
        assert_eq!(seconds(&lines).iter().map(|l| l.2).collect::<Vec<_>>(), vec![0, 1]);
        assert!(attribute(&[window(0.0, 3.0)], &[]).iter().all(|(_, s)| *s == 0));
    }

    #[cfg(feature = "whisper")]
    #[test]
    fn limits_extra_speakers_without_erasing_a_short_reply() {
        let turns = vec![turn(0.0, 30.0, 0), turn(30.0, 31.0, 1), turn(31.0, 60.0, 0), turn(60.8, 61.0, 2), turn(61.0, 90.0, 1)];
        let kept = limit_speakers(turns, 2);
        assert_eq!(kept.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 1, 0, 1, 1]);
    }

    #[cfg(feature = "whisper")]
    #[test]
    fn never_names_more_speakers_than_there_are_colours() {
        let turns: Vec<Turn> = (0..10).map(|s| turn(s as f64 * 20.0, s as f64 * 20.0 + 5.0 + s as f64, s)).collect();
        let kept = limit_speakers(turns, MAX_SPEAKERS);
        assert_eq!(kept.iter().map(|t| t.speaker).max(), Some(MAX_SPEAKERS - 1));
    }
}
