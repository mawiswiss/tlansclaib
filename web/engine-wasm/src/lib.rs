//! Plain C exports, so the page loads the module with `WebAssembly.instantiate` and no glue code.

use std::sync::Mutex;

use engine::windows::{self, PROBE_MAX_SECONDS, PROBE_MIN_SECONDS, Window};

static RESULT: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Reserves `bytes` for the page to write audio or a language code into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(bytes: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(bytes);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// # Safety
/// `pointer` and `bytes` must come from one call to `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, bytes: usize) {
    drop(unsafe { Vec::from_raw_parts(pointer, 0, bytes) });
}

/// Cuts 16 kHz mono audio into lines for the language, as the desktop engine does.
/// Returns a pointer to the line count followed by each line's first and end sample.
///
/// # Safety
/// `audio` must hold `samples` floats and `language` `language_bytes` UTF-8 bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lines(audio: *const f32, samples: usize, language: *const u8, language_bytes: usize) -> *const u32 {
    let audio = unsafe { std::slice::from_raw_parts(audio, samples) };
    let language = std::str::from_utf8(unsafe { std::slice::from_raw_parts(language, language_bytes) }).unwrap_or("");
    let (min, max) = windows::bounds_for(language);
    publish(&windows::split(audio, min, max))
}

/// The lines the language check hears, cut longer than transcription lines.
///
/// # Safety
/// `audio` must hold `samples` floats.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn probe_lines(audio: *const f32, samples: usize) -> *const u32 {
    let audio = unsafe { std::slice::from_raw_parts(audio, samples) };
    publish(&windows::split(audio, PROBE_MIN_SECONDS, PROBE_MAX_SECONDS))
}

fn publish(found: &[Window]) -> *const u32 {
    let mut result = RESULT.lock().unwrap_or_else(|e| e.into_inner());
    result.clear();
    result.push(found.len() as u32);
    for w in found {
        result.push(w.start as u32);
        result.push(w.end as u32);
    }
    result.as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(pointer: *const u32) -> Vec<u32> {
        let count = unsafe { *pointer } as usize;
        unsafe { std::slice::from_raw_parts(pointer, 1 + count * 2) }.to_vec()
    }

    #[test]
    fn silence_has_no_lines() {
        let audio = vec![0.0f32; 16_000 * 3];
        let language = "en";
        let result = read(unsafe { lines(audio.as_ptr(), audio.len(), language.as_ptr(), language.len()) });
        assert_eq!(result, vec![0]);
    }

    #[test]
    fn matches_the_engine() {
        let audio: Vec<f32> = (0..16_000 * 40).map(|i| if (i / 16_000) % 9 < 7 { ((i as f32) * 0.05).sin() * 0.3 } else { 0.0 }).collect();
        let language = "th";
        let result = read(unsafe { lines(audio.as_ptr(), audio.len(), language.as_ptr(), language.len()) });
        let (min, max) = windows::bounds_for("th");
        let expected = windows::split(&audio, min, max);
        assert_eq!(result[0] as usize, expected.len());
        assert!(!expected.is_empty());
        for (i, w) in expected.iter().enumerate() {
            assert_eq!((result[1 + i * 2] as usize, result[2 + i * 2] as usize), (w.start, w.end));
        }
    }
}
