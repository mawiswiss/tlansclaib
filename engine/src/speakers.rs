#[cfg(feature = "whisper")]
use std::ffi::{CString, c_char, c_void};
use std::path::{Path, PathBuf};

#[cfg(feature = "whisper")]
use anyhow::{Context, Result, anyhow, bail};
#[cfg(feature = "whisper")]
use libloading::Library;

use crate::RATE;
use crate::windows::Window;

/// The sherpa-onnx release whose C API the structs below mirror.
pub const SHERPA_ONNX_VERSION: &str = "1.13.8";
pub const SEGMENTATION_FILE: &str = "segmentation.onnx";
pub const EMBEDDING_FILE: &str = "embedding.onnx";
// The sherpa-onnx default of 0.5 split a call of three or four people into dozens, and 1.1 merged
// the two voices of a short clip. Tuned on those two recordings only.
pub const DEFAULT_THRESHOLD: f32 = 1.0;
// sherpa-onnx's default. A quarter halved the work but put a speaker change 1.4 s late in a test.
pub const WINDOW_SHIFT: f32 = 0.1;
// The "fast" choice: 2.8 times quicker on a call, with 2 of 29 long turns given to the wrong side.
pub const FAST_WINDOW_SHIFT: f32 = 0.25;
pub const MIN_ON: f32 = 0.3;
pub const MIN_OFF: f32 = 0.5;

#[cfg(target_os = "macos")]
pub const LIBRARY_FILE: &str = "libsherpa-onnx-c-api.dylib";
#[cfg(target_os = "windows")]
pub const LIBRARY_FILE: &str = "sherpa-onnx-c-api.dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub const LIBRARY_FILE: &str = "libsherpa-onnx-c-api.so";

const SHORTEST_PART_SECONDS: f64 = 0.3;
#[cfg(feature = "whisper")]
const MINOR_SECONDS: f64 = 10.0;
#[cfg(feature = "whisper")]
const MINOR_SHARE: f64 = 0.05;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    pub start: f64,
    pub end: f64,
    pub speaker: usize,
}

#[cfg(feature = "whisper")]
pub struct Detection<'a> {
    pub folder: &'a Path,
    pub speakers: Option<usize>,
    pub threshold: f32,
    pub threads: usize,
    pub window_shift: f32,
    pub min_on: f32,
    pub min_off: f32,
}

#[cfg(feature = "whisper")]
#[repr(C)]
struct PyannoteConfig {
    model: *const c_char,
    window_shift_ratio: f32,
}

#[cfg(feature = "whisper")]
#[repr(C)]
struct SegmentationConfig {
    pyannote: PyannoteConfig,
    num_threads: i32,
    debug: i32,
    provider: *const c_char,
}

#[cfg(feature = "whisper")]
#[repr(C)]
struct EmbeddingConfig {
    model: *const c_char,
    num_threads: i32,
    debug: i32,
    provider: *const c_char,
}

#[cfg(feature = "whisper")]
#[repr(C)]
struct ClusteringConfig {
    num_clusters: i32,
    threshold: f32,
    compute_confidence: i32,
}

#[cfg(feature = "whisper")]
#[repr(C)]
struct DiarizationConfig {
    segmentation: SegmentationConfig,
    embedding: EmbeddingConfig,
    clustering: ClusteringConfig,
    min_duration_on: f32,
    min_duration_off: f32,
}

#[cfg(feature = "whisper")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Segment {
    start: f32,
    end: f32,
    speaker: i32,
    confidence: f32,
}

#[cfg(feature = "whisper")]
type Progress = unsafe extern "C" fn(i32, i32, *mut c_void) -> i32;

pub fn library_path(folder: &Path) -> PathBuf {
    folder.join("lib").join(LIBRARY_FILE)
}

#[cfg(feature = "whisper")]
fn open(path: &Path) -> Result<Library> {
    #[cfg(windows)]
    let library = unsafe {
        libloading::os::windows::Library::load_with_flags(path, libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH)
            .map(Library::from)
    };
    #[cfg(not(windows))]
    let library = unsafe { Library::new(path) };
    library.with_context(|| format!("cannot load speaker detection from {}", path.display()))
}

#[cfg(feature = "whisper")]
/// Speakers are numbered in order of their first turn.
pub fn detect(audio: &[f32], detection: &Detection, mut progress: impl FnMut(usize, usize)) -> Result<Vec<Turn>> {
    let folder = detection.folder;
    let segmentation = folder.join(SEGMENTATION_FILE);
    let embedding = folder.join(EMBEDDING_FILE);
    for file in [&segmentation, &embedding] {
        if !file.is_file() {
            bail!("speaker detection is incomplete, {} is missing. Remove it in Models and download it again.", file.display());
        }
    }
    let samples = i32::try_from(audio.len()).map_err(|_| anyhow!("the recording is too long for speaker detection"))?;
    let library = open(&library_path(folder))?;
    let c = |path: &Path| CString::new(path.to_string_lossy().as_bytes()).context("a path holds a NUL byte");
    let (segmentation, embedding, provider) = (c(&segmentation)?, c(&embedding)?, CString::new("cpu").unwrap());
    let threads = detection.threads.clamp(1, 64) as i32;
    let config = DiarizationConfig {
        segmentation: SegmentationConfig {
            pyannote: PyannoteConfig { model: segmentation.as_ptr(), window_shift_ratio: detection.window_shift },
            num_threads: threads,
            debug: 0,
            provider: provider.as_ptr(),
        },
        embedding: EmbeddingConfig { model: embedding.as_ptr(), num_threads: threads, debug: 0, provider: provider.as_ptr() },
        clustering: ClusteringConfig {
            num_clusters: detection.speakers.map(|n| n as i32).unwrap_or(-1),
            threshold: detection.threshold,
            compute_confidence: 0,
        },
        min_duration_on: detection.min_on,
        min_duration_off: detection.min_off,
    };

    unsafe {
        let create = library.get::<unsafe extern "C" fn(*const DiarizationConfig) -> *const c_void>(
            b"SherpaOnnxCreateOfflineSpeakerDiarization\0",
        )?;
        let destroy = library.get::<unsafe extern "C" fn(*const c_void)>(b"SherpaOnnxDestroyOfflineSpeakerDiarization\0")?;
        let rate = library.get::<unsafe extern "C" fn(*const c_void) -> i32>(b"SherpaOnnxOfflineSpeakerDiarizationGetSampleRate\0")?;
        let process = library.get::<unsafe extern "C" fn(*const c_void, *const f32, i32, Option<Progress>, *mut c_void) -> *const c_void>(
            b"SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback\0",
        )?;
        let count = library.get::<unsafe extern "C" fn(*const c_void) -> i32>(b"SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments\0")?;
        let sorted = library.get::<unsafe extern "C" fn(*const c_void) -> *const Segment>(
            b"SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime\0",
        )?;
        let free_segments = library.get::<unsafe extern "C" fn(*const Segment)>(b"SherpaOnnxOfflineSpeakerDiarizationDestroySegment\0")?;
        let free_result = library.get::<unsafe extern "C" fn(*const c_void)>(b"SherpaOnnxOfflineSpeakerDiarizationDestroyResult\0")?;

        let detector = create(&config);
        if detector.is_null() {
            bail!("speaker detection could not start. Its files may be damaged: remove it in Models and download it again.");
        }
        if rate(detector) as usize != RATE {
            destroy(detector);
            bail!("speaker detection expects another sample rate");
        }
        let mut report: &mut dyn FnMut(usize, usize) = &mut progress;
        let result = process(detector, audio.as_ptr(), samples, Some(forward), &mut report as *mut _ as *mut c_void);
        if result.is_null() {
            destroy(detector);
            bail!("speaker detection failed on this recording");
        }
        let n = count(result).max(0) as usize;
        let segments = sorted(result);
        let turns: Vec<(f64, f64, i32)> = if segments.is_null() || n == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(segments, n)
                .iter()
                .map(|s| (s.start as f64, s.end as f64, s.speaker))
                .collect()
        };
        if !segments.is_null() {
            free_segments(segments);
        }
        free_result(result);
        destroy(detector);
        let turns = renumber(turns);
        Ok(if detection.speakers.is_none() { absorb_minor(turns) } else { turns })
    }
}

#[cfg(feature = "whisper")]
fn absorb_minor(turns: Vec<Turn>) -> Vec<Turn> {
    let count = turns.iter().map(|t| t.speaker + 1).max().unwrap_or(0);
    let mut spoken = vec![0.0f64; count];
    for t in &turns {
        spoken[t.speaker] += t.end - t.start;
    }
    let total: f64 = spoken.iter().sum();
    let minor = |s: usize| spoken[s] < MINOR_SECONDS && spoken[s] < MINOR_SHARE * total;
    if (0..count).all(minor) {
        return turns;
    }
    let major: Vec<Turn> = turns.iter().copied().filter(|t| !minor(t.speaker)).collect();
    let moved = turns
        .iter()
        .map(|t| if minor(t.speaker) { (t.start, t.end, nearest(&major, (t.start + t.end) / 2.0) as i32) } else { (t.start, t.end, t.speaker as i32) })
        .collect();
    renumber(moved)
}

#[cfg(feature = "whisper")]
unsafe extern "C" fn forward(done: i32, total: i32, arg: *mut c_void) -> i32 {
    let report = unsafe { &mut *(arg as *mut &mut dyn FnMut(usize, usize)) };
    report(done.max(0) as usize, total.max(0) as usize);
    0
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

/// Turns without overlap: where two overlap, the one already speaking keeps the floor.
fn timeline(turns: &[Turn]) -> Vec<Turn> {
    let mut sorted = turns.to_vec();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut flat: Vec<Turn> = Vec::new();
    for mut turn in sorted {
        if let Some(last) = flat.last() {
            turn.start = turn.start.max(last.end);
        }
        if turn.end <= turn.start {
            continue;
        }
        match flat.last_mut() {
            Some(last) if last.speaker == turn.speaker && turn.start - last.end < 0.5 => last.end = turn.end,
            _ => flat.push(turn),
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
mod tests {
    use super::*;

    fn window(from: f64, to: f64) -> Window {
        Window { start: (from * RATE as f64) as usize, end: (to * RATE as f64) as usize }
    }

    fn turn(start: f64, end: f64, speaker: usize) -> Turn {
        Turn { start, end, speaker }
    }

    fn seconds(lines: &[(Window, usize)]) -> Vec<(f64, f64, usize)> {
        lines.iter().map(|(w, s)| (w.start_seconds(), w.end_seconds(), *s)).collect()
    }

    #[test]
    fn numbers_speakers_by_their_first_turn() {
        let turns = renumber(vec![(0.0, 2.0, 7), (2.5, 4.0, 3), (4.5, 6.0, 7), (6.0, 6.0, 9)]);
        assert_eq!(turns.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 1, 0]);
    }

    #[test]
    fn gives_the_turns_of_a_voice_heard_only_briefly_to_its_neighbours() {
        let turns = vec![turn(0.0, 30.0, 0), turn(30.0, 32.0, 1), turn(32.5, 60.0, 2), turn(60.0, 90.0, 0)];
        let kept = absorb_minor(turns);
        assert_eq!(kept.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 0, 1, 0]);
        let short = vec![turn(0.0, 4.0, 0), turn(4.0, 8.0, 1)];
        assert_eq!(absorb_minor(short.clone()), short);
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
    fn the_one_already_speaking_keeps_an_overlap() {
        let flat = timeline(&[turn(0.0, 6.0, 0), turn(4.0, 9.0, 1), turn(5.0, 5.5, 2)]);
        assert_eq!(flat, vec![turn(0.0, 6.0, 0), turn(6.0, 9.0, 1)]);
    }

    #[test]
    fn a_line_outside_every_turn_takes_the_nearest_speaker() {
        let lines = attribute(&[window(0.0, 3.0), window(30.0, 34.0)], &[turn(5.0, 9.0, 0), turn(20.0, 25.0, 1)]);
        assert_eq!(seconds(&lines).iter().map(|l| l.2).collect::<Vec<_>>(), vec![0, 1]);
        assert!(attribute(&[window(0.0, 3.0)], &[]).iter().all(|(_, s)| *s == 0));
    }
}
