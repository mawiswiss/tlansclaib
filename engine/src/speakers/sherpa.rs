#[cfg(feature = "whisper")]
use std::ffi::{CString, c_char, c_void};
use std::path::{Path, PathBuf};

#[cfg(feature = "whisper")]
use anyhow::{Context, Result, anyhow, bail};

#[cfg(feature = "whisper")]
use super::{Turn, nearest, open, renumber};
#[cfg(feature = "whisper")]
use crate::RATE;

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

#[cfg(feature = "whisper")]
const MINOR_SECONDS: f64 = 10.0;
#[cfg(feature = "whisper")]
const MINOR_SHARE: f64 = 0.05;

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
pub fn check(folder: &Path) -> Result<()> {
    let library = open(&library_path(folder))?;
    unsafe { library.get::<unsafe extern "C" fn()>(b"SherpaOnnxCreateOfflineSpeakerDiarization\0")? };
    Ok(())
}

#[cfg(feature = "whisper")]
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

#[cfg(all(test, feature = "whisper"))]
mod tests {
    use super::*;
    use crate::speakers::tests::turn;

    #[test]
    fn gives_the_turns_of_a_voice_heard_only_briefly_to_its_neighbours() {
        let turns = vec![turn(0.0, 30.0, 0), turn(30.0, 32.0, 1), turn(32.5, 60.0, 2), turn(60.0, 90.0, 0)];
        let kept = absorb_minor(turns);
        assert_eq!(kept.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 0, 1, 0]);
        let short = vec![turn(0.0, 4.0, 0), turn(4.0, 8.0, 1)];
        assert_eq!(absorb_minor(short.clone()), short);
    }
}
