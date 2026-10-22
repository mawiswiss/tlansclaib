#[cfg(feature = "whisper")]
use std::ffi::{CStr, CString, c_char, c_void};
#[cfg(feature = "whisper")]
use std::io::Read;
use std::path::{Path, PathBuf};

#[cfg(feature = "whisper")]
use anyhow::{Context, Result, anyhow, bail};
#[cfg(feature = "whisper")]
use libloading::Library;
#[cfg(feature = "whisper")]
use serde::Deserialize;
#[cfg(feature = "whisper")]
use sha2::{Digest, Sha256};

use crate::RATE;
use crate::windows::Window;

pub const DETECTION_VERSION: &str = "parakeet-0.6.1-nemotron3-f16";
pub const MODEL_FILE: &str = "nemotron-3-diarization-f16.gguf";
pub const MODEL_SIZE: u64 = 200_715_072;
pub const MODEL_SHA256: &str = "b0edbc0ca9bbe1e35bf79d7df80bdec4a7c0f588b943d1346856891a0e628534";
pub const MAX_SPEAKERS: usize = 8;

#[cfg(target_os = "macos")]
pub const LIBRARY_FILE: &str = "libparakeet.dylib";
#[cfg(target_os = "windows")]
pub const LIBRARY_FILE: &str = "parakeet.dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub const LIBRARY_FILE: &str = "libparakeet.so";

const SHORTEST_PART_SECONDS: f64 = 0.3;

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
}

#[cfg(feature = "whisper")]
#[derive(Deserialize)]
struct Diarization {
    segments: Vec<Segment>,
}

#[cfg(feature = "whisper")]
#[derive(Deserialize)]
struct Segment {
    start: f64,
    end: f64,
    speaker: usize,
}

pub fn library_path(folder: &Path) -> PathBuf {
    folder.join("lib").join(LIBRARY_FILE)
}

#[cfg(feature = "whisper")]
fn open(path: &Path) -> Result<Library> {
    #[cfg(windows)]
    let library = unsafe {
        libloading::os::windows::Library::load_with_flags(
            path,
            libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH,
        )
        .map(Library::from)
    };
    #[cfg(not(windows))]
    let library = unsafe { Library::new(path) };
    library.with_context(|| format!("cannot load speaker detection from {}", path.display()))
}

#[cfg(feature = "whisper")]
fn validate_model(path: &Path) -> Result<()> {
    if std::fs::metadata(path).map_or(true, |m| m.len() != MODEL_SIZE) {
        bail!(
            "speaker model is missing or damaged. Remove speaker detection in Models and download it again."
        );
    }
    let mut file = std::io::BufReader::new(std::fs::File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buf)?;
        if count == 0 {
            break;
        }
        hasher.update(&buf[..count]);
    }
    if hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
        != MODEL_SHA256
    {
        bail!(
            "speaker model failed validation. Remove speaker detection in Models and download it again."
        );
    }
    Ok(())
}

#[cfg(feature = "whisper")]
fn ffi_error(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return "unknown error".into();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

#[cfg(feature = "whisper")]
pub fn detect(
    audio: &[f32],
    detection: &Detection,
    mut progress: impl FnMut(usize, usize),
) -> Result<Vec<Turn>> {
    let model = detection.folder.join(MODEL_FILE);
    validate_model(&model)?;
    let samples = i32::try_from(audio.len())
        .map_err(|_| anyhow!("the recording is too long for speaker detection"))?;
    let library = open(&library_path(detection.folder))?;
    let path =
        CString::new(model.to_string_lossy().as_bytes()).context("a path holds a NUL byte")?;
    progress(0, 1);
    unsafe {
        let abi = library.get::<unsafe extern "C" fn() -> i32>(b"parakeet_capi_abi_version\0")?;
        let load = library
            .get::<unsafe extern "C" fn(*const c_char) -> *mut c_void>(b"parakeet_capi_load\0")?;
        let load_error = library
            .get::<unsafe extern "C" fn() -> *const c_char>(b"parakeet_capi_load_error\0")?;
        let kind = library
            .get::<unsafe extern "C" fn(*const c_void) -> i32>(b"parakeet_capi_model_kind\0")?;
        let process =
            library.get::<unsafe extern "C" fn(*mut c_void, *const f32, i32, i32) -> *mut c_char>(
                b"parakeet_capi_diarize_pcm\0",
            )?;
        let last_error = library.get::<unsafe extern "C" fn(*mut c_void) -> *const c_char>(
            b"parakeet_capi_last_error\0",
        )?;
        let free_string =
            library.get::<unsafe extern "C" fn(*mut c_char)>(b"parakeet_capi_free_string\0")?;
        let free = library.get::<unsafe extern "C" fn(*mut c_void)>(b"parakeet_capi_free\0")?;
        if abi() != 10 {
            bail!(
                "speaker detection library has the wrong version. Remove it in Models and download it again."
            );
        }
        let context = load(path.as_ptr());
        if context.is_null() {
            bail!(
                "speaker detection could not load its model: {}",
                ffi_error(load_error())
            );
        }
        let result = (|| -> Result<Vec<Turn>> {
            if kind(context) != 2 {
                bail!("speaker detection loaded the wrong kind of model");
            }
            let output = process(context, audio.as_ptr(), samples, RATE as i32);
            if output.is_null() {
                bail!(
                    "speaker detection failed: {}",
                    ffi_error(last_error(context))
                );
            }
            let bytes = CStr::from_ptr(output).to_bytes().to_vec();
            free_string(output);
            let result: Diarization = serde_json::from_slice(&bytes)
                .context("speaker detection returned invalid data")?;
            let mut segments = result.segments;
            if segments.iter().any(|s| {
                !s.start.is_finite()
                    || !s.end.is_finite()
                    || s.start < 0.0
                    || s.end <= s.start
                    || s.speaker >= MAX_SPEAKERS
            }) {
                bail!("speaker detection returned invalid turns");
            }
            segments.sort_by(|a, b| a.start.total_cmp(&b.start));
            let turns = renumber(
                segments
                    .into_iter()
                    .map(|s| (s.start, s.end, s.speaker as i32))
                    .collect(),
            );
            Ok(match detection.speakers {
                Some(count) => limit_speakers(turns, count),
                None => turns,
            })
        })();
        free(context);
        progress(1, 1);
        result
    }
}

#[cfg(feature = "whisper")]
fn limit_speakers(turns: Vec<Turn>, count: usize) -> Vec<Turn> {
    let found = turns.iter().map(|t| t.speaker + 1).max().unwrap_or(0);
    if found <= count {
        return turns;
    }
    let mut ranked: Vec<(usize, f64)> = (0..found)
        .map(|speaker| {
            (
                speaker,
                turns
                    .iter()
                    .filter(|t| t.speaker == speaker)
                    .map(|t| t.end - t.start)
                    .sum(),
            )
        })
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let kept: Vec<usize> = ranked
        .into_iter()
        .take(count)
        .map(|(speaker, _)| speaker)
        .collect();
    let major: Vec<Turn> = turns
        .iter()
        .copied()
        .filter(|t| kept.contains(&t.speaker))
        .collect();
    renumber(
        turns
            .iter()
            .map(|t| {
                let speaker = if kept.contains(&t.speaker) {
                    t.speaker
                } else {
                    nearest(&major, (t.start + t.end) / 2.0)
                };
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
            Turn {
                start,
                end,
                speaker,
            }
        })
        .collect()
}

fn timeline(turns: &[Turn]) -> Vec<Turn> {
    let mut edges: Vec<f64> = turns
        .iter()
        .flat_map(|turn| [turn.start, turn.end])
        .collect();
    edges.sort_by(f64::total_cmp);
    edges.dedup();
    let mut flat: Vec<Turn> = Vec::new();
    for pair in edges.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let Some(chosen) = turns
            .iter()
            .filter(|t| t.start < end && t.end > start)
            .min_by(|a, b| {
                ((a.end - a.start) > 2.0)
                    .cmp(&((b.end - b.start) > 2.0))
                    .then_with(|| a.start.total_cmp(&b.start))
            })
        else {
            continue;
        };
        match flat.last_mut() {
            Some(last) if last.speaker == chosen.speaker && start - last.end < 0.5 => {
                last.end = end
            }
            _ => flat.push(Turn {
                start,
                end,
                speaker: chosen.speaker,
            }),
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
            let piece = Turn {
                start: turn.start.max(from),
                end: turn.end.min(to),
                speaker: turn.speaker,
            };
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
        while let Some(i) = parts
            .iter()
            .position(|p| p.end - p.start < SHORTEST_PART_SECONDS)
            .filter(|_| parts.len() > 1)
        {
            let length = |p: &Turn| p.end - p.start;
            let into = if i == 0
                || (i + 1 < parts.len() && length(&parts[i + 1]) > length(&parts[i - 1]))
            {
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
            } else if target + 1 < parts.len() && parts[target + 1].speaker == parts[target].speaker
            {
                let merged = parts.remove(target + 1);
                parts[target].end = merged.end;
            }
        }
        let last = parts.len() - 1;
        for (i, part) in parts.iter().enumerate() {
            let start = if i == 0 {
                window.start
            } else {
                (part.start * RATE as f64).round() as usize
            };
            let end = if i == last {
                window.end
            } else {
                (part.end * RATE as f64).round() as usize
            };
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
        Window {
            start: (from * RATE as f64) as usize,
            end: (to * RATE as f64) as usize,
        }
    }

    fn turn(start: f64, end: f64, speaker: usize) -> Turn {
        Turn {
            start,
            end,
            speaker,
        }
    }

    fn seconds(lines: &[(Window, usize)]) -> Vec<(f64, f64, usize)> {
        lines
            .iter()
            .map(|(w, s)| (w.start_seconds(), w.end_seconds(), *s))
            .collect()
    }

    #[test]
    fn numbers_speakers_by_their_first_turn() {
        let turns = renumber(vec![
            (0.0, 2.0, 7),
            (2.5, 4.0, 3),
            (4.5, 6.0, 7),
            (6.0, 6.0, 9),
        ]);
        assert_eq!(
            turns.iter().map(|t| t.speaker).collect::<Vec<_>>(),
            vec![0, 1, 0]
        );
    }

    #[test]
    fn limits_extra_speakers_without_erasing_a_short_reply() {
        let turns = vec![
            turn(0.0, 30.0, 0),
            turn(30.0, 31.0, 1),
            turn(31.0, 60.0, 0),
            turn(60.8, 61.0, 2),
            turn(61.0, 90.0, 1),
        ];
        let kept = limit_speakers(turns, 2);
        assert_eq!(
            kept.iter().map(|t| t.speaker).collect::<Vec<_>>(),
            vec![0, 1, 0, 1, 1]
        );
    }

    #[test]
    fn keeps_a_line_whole_when_one_person_speaks() {
        let lines = attribute(&[window(0.0, 8.0)], &[turn(0.2, 7.5, 0)]);
        assert_eq!(seconds(&lines), vec![(0.0, 8.0, 0)]);
    }

    #[test]
    fn cuts_a_line_where_the_speaker_changes() {
        let lines = attribute(
            &[window(10.0, 20.0)],
            &[turn(9.0, 14.0, 1), turn(14.4, 21.0, 0)],
        );
        assert_eq!(seconds(&lines), vec![(10.0, 14.2, 0), (14.2, 20.0, 1)]);
    }

    #[test]
    fn keeps_a_short_reply_as_its_own_line() {
        let lines = attribute(
            &[window(0.0, 12.0)],
            &[turn(0.0, 5.0, 0), turn(5.0, 5.6, 1), turn(5.6, 12.0, 0)],
        );
        assert_eq!(
            seconds(&lines),
            vec![(0.0, 5.0, 0), (5.0, 5.6, 1), (5.6, 12.0, 0)]
        );
    }

    #[test]
    fn folds_a_short_piece_at_a_window_edge() {
        let lines = attribute(&[window(0.0, 5.0)], &[turn(0.0, 4.8, 0), turn(4.8, 7.0, 1)]);
        assert_eq!(seconds(&lines), vec![(0.0, 5.0, 0)]);
    }

    #[test]
    fn a_short_reply_keeps_its_full_span_in_an_overlap() {
        let flat = timeline(&[turn(0.0, 6.0, 0), turn(4.0, 9.0, 1), turn(5.0, 5.5, 2)]);
        assert_eq!(
            flat,
            vec![
                turn(0.0, 5.0, 0),
                turn(5.0, 5.5, 2),
                turn(5.5, 6.0, 0),
                turn(6.0, 9.0, 1)
            ]
        );
    }

    #[test]
    fn cuts_a_line_around_a_short_reply_even_when_the_other_voice_overlaps() {
        let lines = attribute(
            &[window(0.0, 10.0)],
            &[turn(0.0, 5.0, 0), turn(4.0, 5.0, 1), turn(4.5, 10.0, 0)],
        );
        assert_eq!(
            seconds(&lines),
            vec![(0.0, 4.0, 0), (4.0, 5.0, 1), (5.0, 10.0, 0)]
        );
    }

    #[test]
    fn a_line_outside_every_turn_takes_the_nearest_speaker() {
        let lines = attribute(
            &[window(0.0, 3.0), window(30.0, 34.0)],
            &[turn(5.0, 9.0, 0), turn(20.0, 25.0, 1)],
        );
        assert_eq!(
            seconds(&lines).iter().map(|l| l.2).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert!(
            attribute(&[window(0.0, 3.0)], &[])
                .iter()
                .all(|(_, s)| *s == 0)
        );
    }
}
