#[cfg(feature = "whisper")]
use std::ffi::{CStr, CString, c_char, c_void};
#[cfg(feature = "whisper")]
use std::io::Read;
use std::path::{Path, PathBuf};

#[cfg(feature = "whisper")]
use anyhow::{Context, Result, anyhow, bail};
#[cfg(feature = "whisper")]
use serde::Deserialize;
#[cfg(feature = "whisper")]
use sha2::{Digest, Sha256};

#[cfg(feature = "whisper")]
use super::{Turn, nearest, open, renumber};
#[cfg(feature = "whisper")]
use crate::RATE;

pub const DETECTION_VERSION: &str = "parakeet-0.6.1-nemotron3-f16";
pub const MODEL_FILE: &str = "nemotron-3-diarization-f16.gguf";
pub const MODEL_SIZE: u64 = 200_715_072;
pub const MODEL_SHA256: &str = "b0edbc0ca9bbe1e35bf79d7df80bdec4a7c0f588b943d1346856891a0e628534";
pub const MAX_SPEAKERS: usize = 8;
#[cfg(feature = "whisper")]
const ABI_VERSION: i32 = 10;

#[cfg(target_os = "macos")]
pub const LIBRARY_FILE: &str = "libparakeet.dylib";
#[cfg(target_os = "windows")]
pub const LIBRARY_FILE: &str = "parakeet.dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub const LIBRARY_FILE: &str = "libparakeet.so";

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
fn validate_model(path: &Path) -> Result<()> {
    if std::fs::metadata(path).map_or(true, |m| m.len() != MODEL_SIZE) {
        bail!("speaker model is missing or damaged. Remove speaker detection in Models and download it again.");
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
    if hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>() != MODEL_SHA256 {
        bail!("speaker model failed validation. Remove speaker detection in Models and download it again.");
    }
    Ok(())
}

#[cfg(feature = "whisper")]
fn ffi_error(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return "unknown error".into();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

#[cfg(feature = "whisper")]
pub fn check(folder: &Path) -> Result<()> {
    let library = open(&library_path(folder))?;
    let abi = unsafe { library.get::<unsafe extern "C" fn() -> i32>(b"parakeet_capi_abi_version\0")? };
    if unsafe { abi() } != ABI_VERSION {
        bail!("speaker detection library has the wrong version. Remove it in Models and download it again.");
    }
    Ok(())
}

#[cfg(feature = "whisper")]
pub fn detect(audio: &[f32], detection: &Detection, mut progress: impl FnMut(usize, usize)) -> Result<Vec<Turn>> {
    let model = detection.folder.join(MODEL_FILE);
    validate_model(&model)?;
    let samples = i32::try_from(audio.len()).map_err(|_| anyhow!("the recording is too long for speaker detection"))?;
    let library = open(&library_path(detection.folder))?;
    let path = CString::new(model.to_string_lossy().as_bytes()).context("a path holds a NUL byte")?;
    progress(0, 1);
    unsafe {
        let abi = library.get::<unsafe extern "C" fn() -> i32>(b"parakeet_capi_abi_version\0")?;
        let load = library.get::<unsafe extern "C" fn(*const c_char) -> *mut c_void>(b"parakeet_capi_load\0")?;
        let load_error = library.get::<unsafe extern "C" fn() -> *const c_char>(b"parakeet_capi_load_error\0")?;
        let kind = library.get::<unsafe extern "C" fn(*const c_void) -> i32>(b"parakeet_capi_model_kind\0")?;
        let process = library.get::<unsafe extern "C" fn(*mut c_void, *const f32, i32, i32) -> *mut c_char>(b"parakeet_capi_diarize_pcm\0")?;
        let last_error = library.get::<unsafe extern "C" fn(*mut c_void) -> *const c_char>(b"parakeet_capi_last_error\0")?;
        let free_string = library.get::<unsafe extern "C" fn(*mut c_char)>(b"parakeet_capi_free_string\0")?;
        let free = library.get::<unsafe extern "C" fn(*mut c_void)>(b"parakeet_capi_free\0")?;
        if abi() != ABI_VERSION {
            bail!("speaker detection library has the wrong version. Remove it in Models and download it again.");
        }
        let context = load(path.as_ptr());
        if context.is_null() {
            bail!("speaker detection could not load its model: {}", ffi_error(load_error()));
        }
        let result = (|| -> Result<Vec<Turn>> {
            if kind(context) != 2 {
                bail!("speaker detection loaded the wrong kind of model");
            }
            let output = process(context, audio.as_ptr(), samples, RATE as i32);
            if output.is_null() {
                bail!("speaker detection failed: {}", ffi_error(last_error(context)));
            }
            let bytes = CStr::from_ptr(output).to_bytes().to_vec();
            free_string(output);
            let result: Diarization = serde_json::from_slice(&bytes).context("speaker detection returned invalid data")?;
            let mut segments = result.segments;
            if segments
                .iter()
                .any(|s| !s.start.is_finite() || !s.end.is_finite() || s.start < 0.0 || s.end <= s.start || s.speaker >= MAX_SPEAKERS)
            {
                bail!("speaker detection returned invalid turns");
            }
            segments.sort_by(|a, b| a.start.total_cmp(&b.start));
            let turns = renumber(segments.into_iter().map(|s| (s.start, s.end, s.speaker as i32)).collect());
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

#[cfg(all(test, feature = "whisper"))]
mod tests {
    use super::*;
    use crate::speakers::tests::turn;

    #[test]
    fn limits_extra_speakers_without_erasing_a_short_reply() {
        let turns = vec![turn(0.0, 30.0, 0), turn(30.0, 31.0, 1), turn(31.0, 60.0, 0), turn(60.8, 61.0, 2), turn(61.0, 90.0, 1)];
        let kept = limit_speakers(turns, 2);
        assert_eq!(kept.iter().map(|t| t.speaker).collect::<Vec<_>>(), vec![0, 1, 0, 1, 1]);
    }
}
