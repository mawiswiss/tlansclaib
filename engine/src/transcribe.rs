use std::ffi::{CStr, c_char, c_void};
use std::path::Path;
use std::sync::Mutex;

use anyhow::{Result, anyhow};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use crate::RATE;

pub struct Engine {
    context: WhisperContext,
    pub threads: usize,
    pub device: &'static str,
    pub device_name: Option<String>,
    pub decoding: Decoding,
}

static BACKEND_NAME: Mutex<Option<String>> = Mutex::new(None);

unsafe extern "C" fn whisper_log(level: whisper_rs::whisper_rs_sys::ggml_log_level, text: *const c_char, _: *mut c_void) {
    if text.is_null() {
        return;
    }
    let message = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let message = message.trim();
    if let Some(name) = selected_backend(message) {
        if let Ok(mut backend) = BACKEND_NAME.lock() {
            *backend = Some(name.to_string());
        }
        return;
    } else if message.starts_with("whisper_backend_init_gpu: failed to initialize ")
        && let Ok(mut backend) = BACKEND_NAME.lock()
    {
        *backend = None;
    }
    use whisper_rs::whisper_rs_sys as sys;
    match level {
        sys::ggml_log_level_GGML_LOG_LEVEL_ERROR => log::error!(target: "whisper", "{message}"),
        sys::ggml_log_level_GGML_LOG_LEVEL_WARN => log::warn!(target: "whisper", "{message}"),
        sys::ggml_log_level_GGML_LOG_LEVEL_DEBUG => log::debug!(target: "whisper", "{message}"),
        _ => log::info!(target: "whisper", "{message}"),
    }
}

fn selected_backend(message: &str) -> Option<&str> {
    message.strip_prefix("whisper_backend_init_gpu: using ")?.strip_suffix(" backend")
}

#[derive(Clone, Copy, Debug)]
pub struct Decoding {
    pub beam_size: usize,
    pub temperature_inc: f32,
    pub entropy_thold: f32,
    pub logprob_thold: f32,
}

impl Default for Decoding {
    fn default() -> Decoding {
        Decoding {
            beam_size: 1,
            temperature_inc: 0.2,
            entropy_thold: 2.8,
            logprob_thold: -1.0,
        }
    }
}

pub fn default_threads() -> usize {
    num_cpus::get_physical().saturating_sub(1).max(1)
}

impl Engine {
    pub fn load(model: &Path, threads: usize, use_gpu: bool) -> Result<Engine> {
        whisper_rs::install_logging_hooks();
        unsafe { whisper_rs::set_log_callback(Some(whisper_log), std::ptr::null_mut()) };
        *BACKEND_NAME.lock().unwrap() = None;
        let path = model
            .to_str()
            .ok_or_else(|| anyhow!("the model path is not valid UTF-8"))?;
        let mut params = WhisperContextParameters::default();
        #[cfg(all(target_os = "windows", feature = "vulkan"))]
        let use_gpu = use_gpu && vulkan_free_memory().is_some();
        params.use_gpu(use_gpu);
        let context = WhisperContext::new_with_params(path, params).map_err(|error| {
            anyhow!(
                "cannot load the model {}: the file is damaged or incomplete ({error}). Delete it, then add or download it again.",
                model.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
            )
        })?;
        Ok(Engine {
            context,
            threads,
            device: "cpu",
            device_name: None,
            decoding: Decoding::default(),
        })
    }

    pub fn is_multilingual(&self) -> bool {
        self.context.is_multilingual()
    }

    pub fn state(&mut self) -> Result<WhisperState> {
        let state = self.context.create_state()?;
        self.device_name = BACKEND_NAME.lock().unwrap().clone();
        self.device = if self.device_name.is_none() {
            "cpu"
        } else if cfg!(target_os = "macos") {
            "metal"
        } else if cfg!(all(target_os = "windows", feature = "vulkan")) {
            "vulkan"
        } else {
            "cpu"
        };
        Ok(state)
    }

    pub fn detect_language(&self, state: &mut WhisperState, samples: &[f32]) -> Result<String> {
        state.pcm_to_mel(samples, self.threads)?;
        let (id, _) = state.lang_detect(0, self.threads)?;
        whisper_rs::get_lang_str(id)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("whisper reported an unknown language id {id}"))
    }

    pub fn transcribe(&self, state: &mut WhisperState, samples: &[f32], language: &str) -> Result<String> {
        if samples.len() < RATE {
            return Ok(String::new());
        }
        let strategy = if self.decoding.beam_size > 1 {
            SamplingStrategy::BeamSearch {
                beam_size: self.decoding.beam_size as i32,
                patience: -1.0,
            }
        } else {
            SamplingStrategy::Greedy { best_of: 1 }
        };
        let mut params = FullParams::new(strategy);
        params.set_n_threads(self.threads as i32);
        params.set_language(Some(language));
        params.set_translate(false);
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_single_segment(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_temperature(0.0);
        params.set_temperature_inc(self.decoding.temperature_inc);
        params.set_entropy_thold(self.decoding.entropy_thold);
        params.set_logprob_thold(self.decoding.logprob_thold);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        state.full(params, samples)?;
        let tokens: i32 = state.as_iter().map(|segment| segment.n_tokens()).sum();
        if tokens >= NEAR_TOKEN_LIMIT {
            log::warn!(
                "a {:.1} s window used {tokens} tokens, close to whisper.cpp's limit of 220, so its text may be cut short",
                samples.len() as f32 / RATE as f32
            );
        }
        let mut text = String::new();
        for segment in state.as_iter() {
            let piece = segment.to_str_lossy()?;
            let piece = piece.trim();
            if piece.is_empty() {
                continue;
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(piece);
        }
        Ok(text)
    }
}

#[cfg(all(target_os = "windows", feature = "vulkan"))]
pub fn vulkan_free_memory() -> Option<u64> {
    use whisper_rs::whisper_rs_sys as sys;

    let registered = unsafe {
        if sys::ggml_backend_reg_by_name(c"Vulkan".as_ptr()).is_null() {
            // MSVC static builds can omit Vulkan during registry initialization.
            let backend = sys::ggml_backend_vk_reg();
            if !backend.is_null() {
                sys::ggml_backend_register(backend);
            }
        }
        !sys::ggml_backend_reg_by_name(c"Vulkan".as_ptr()).is_null()
    };
    if !registered {
        return None;
    }
    whisper_rs::vulkan::list_devices().into_iter().next().map(|device| device.vram.free as u64)
}

const NEAR_TOKEN_LIMIT: i32 = 200;

pub fn languages() -> Vec<(String, String)> {
    (0..=whisper_rs::get_lang_max_id())
        .filter_map(|id| {
            Some((
                whisper_rs::get_lang_str(id)?.to_string(),
                whisper_rs::get_lang_str_full(id)?.to_string(),
            ))
        })
        .collect()
}

#[cfg(test)]
mod backend_tests {
    use super::selected_backend;

    #[test]
    fn reads_the_device_whisper_actually_initialized() {
        assert_eq!(selected_backend("whisper_backend_init_gpu: using Apple M4 backend"), Some("Apple M4"));
        assert_eq!(selected_backend("whisper_backend_init_gpu: no GPU found"), None);
    }
}
