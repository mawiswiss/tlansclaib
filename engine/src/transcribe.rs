use std::ffi::{CStr, c_char, c_void};
use std::path::Path;
use std::sync::Mutex;

use anyhow::{Result, anyhow};
use serde::Serialize;
use whisper_rs::whisper_rs_sys as sys;
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use crate::RATE;
use crate::model_file::ModelInfo;

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
    pub fit_encoder: bool,
}

impl Default for Decoding {
    fn default() -> Decoding {
        Decoding {
            beam_size: 1,
            temperature_inc: 0.2,
            entropy_thold: 2.8,
            logprob_thold: -1.0,
            fit_encoder: false,
        }
    }
}

pub fn default_threads() -> usize {
    threads_for(num_cpus::get_physical())
}

// The engine runs at below-normal priority, so a small CPU can give it every core.
fn threads_for(physical: usize) -> usize {
    if physical <= 4 { physical.max(1) } else { physical - 1 }
}

const AUDIO_CTX_FULL: usize = 1500;
const AUDIO_CTX_PER_SECOND: usize = 50;
// Turbo models repeated lines with a margin of 1 or 5 s in tests, not with 10 s.
const AUDIO_CTX_MARGIN: usize = 500;
const SHORTEST_REPEAT: usize = 24;

/// Encoder positions for a window: whisper pads every window to 30 s, 50 positions per second.
pub fn audio_ctx_for(samples: usize) -> usize {
    (samples.div_ceil(RATE) * AUDIO_CTX_PER_SECOND + AUDIO_CTX_MARGIN).min(AUDIO_CTX_FULL)
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
        let use_gpu = use_gpu && gpu().is_some();
        params.use_gpu(use_gpu);
        match crate::model_file::inspect(model) {
            Ok(info) => {
                params.dtw_parameters(DtwParameters { mode: alignment(&info), dtw_mem_size: crate::words::ALIGNMENT_BYTES });
            }
            Err(error) => log::warn!("word times are off, because the model header could not be read: {error:#}"),
        }
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
        self.device_name = BACKEND_NAME.lock().unwrap().clone().map(|name| describe(&name).unwrap_or(name));
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

    pub fn language_probabilities(&self, state: &mut WhisperState, samples: &[f32]) -> Result<Vec<f32>> {
        state.pcm_to_mel(samples, self.threads)?;
        let (_, probabilities) = state.lang_detect(0, self.threads)?;
        Ok(probabilities)
    }

    pub fn transcribe(&self, state: &mut WhisperState, samples: &[f32], language: &str) -> Result<Decoded> {
        if samples.len() < RATE {
            return Ok(Decoded::default());
        }
        let audio_ctx = audio_ctx_for(samples.len());
        if !self.decoding.fit_encoder || audio_ctx == AUDIO_CTX_FULL {
            return self.decode(state, samples, language, 0);
        }
        let decoded = self.decode(state, samples, language, audio_ctx)?;
        if !repeats_itself(&decoded.text) {
            return Ok(decoded);
        }
        log::warn!("a {:.1} s window repeated itself with the shorter encoder, so it was decoded again in full", samples.len() as f32 / RATE as f32);
        self.decode(state, samples, language, 0)
    }

    fn decode(&self, state: &mut WhisperState, samples: &[f32], language: &str, audio_ctx: usize) -> Result<Decoded> {
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
        params.set_audio_ctx(audio_ctx as i32);
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
        let mut tokens = Vec::new();
        let eot = self.context.token_eot();
        for segment in state.as_iter() {
            for token in (0..segment.n_tokens()).filter_map(|i| segment.get_token(i)) {
                if token.token_id() < eot {
                    let at = token.token_data().t_dtw;
                    tokens.push((token.to_bytes()?.to_vec(), (at >= 0).then(|| at as f64 / 100.0)));
                }
            }
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
        Ok(Decoded { text, tokens })
    }
}

/// A line's text, and each text token with the second it starts at within the line, if aligned.
#[derive(Default)]
pub struct Decoded {
    pub text: String,
    pub tokens: Vec<(Vec<u8>, Option<f64>)>,
}

/// The cross-attention heads that follow the audio, known for each original model size.
fn alignment(info: &ModelInfo) -> DtwMode<'static> {
    let english = !info.multilingual;
    let preset = match info.architecture.as_str() {
        "tiny" if english => DtwModelPreset::TinyEn,
        "tiny" => DtwModelPreset::Tiny,
        "base" if english => DtwModelPreset::BaseEn,
        "base" => DtwModelPreset::Base,
        "small" if english => DtwModelPreset::SmallEn,
        "small" => DtwModelPreset::Small,
        "medium" if english => DtwModelPreset::MediumEn,
        "medium" => DtwModelPreset::Medium,
        "large" => DtwModelPreset::LargeV2,
        "large-v3" => DtwModelPreset::LargeV3,
        "large-v3-turbo" => DtwModelPreset::LargeV3Turbo,
        _ => return DtwMode::TopMost { n_top: 1 },
    };
    DtwMode::ModelPreset { model_preset: preset }
}

#[derive(Debug, Serialize)]
pub struct Gpu {
    pub backend: String,
    pub name: String,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

/// The GPU whisper.cpp would pick, started once to prove it works.
pub fn gpu() -> Option<Gpu> {
    register_vulkan();
    unsafe {
        let device = (0..sys::ggml_backend_dev_count()).map(|i| sys::ggml_backend_dev_get(i)).find(|&device| {
            matches!(
                sys::ggml_backend_dev_type(device),
                sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU | sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU
            )
        })?;
        let backend = sys::ggml_backend_dev_init(device, std::ptr::null());
        if backend.is_null() {
            return None;
        }
        sys::ggml_backend_free(backend);
        let (mut free, mut total) = (0usize, 0usize);
        sys::ggml_backend_dev_memory(device, &mut free, &mut total);
        let text = |ptr: *const c_char| (!ptr.is_null()).then(|| CStr::from_ptr(ptr).to_string_lossy().into_owned());
        Some(Gpu {
            backend: text(sys::ggml_backend_reg_name(sys::ggml_backend_dev_backend_reg(device)))?.to_lowercase(),
            name: text(sys::ggml_backend_dev_description(device))?,
            free_bytes: free as u64,
            total_bytes: total as u64,
        })
    }
}

fn describe(device_name: &str) -> Option<String> {
    let name = std::ffi::CString::new(device_name).ok()?;
    unsafe {
        let device = sys::ggml_backend_dev_by_name(name.as_ptr());
        let description = if device.is_null() { std::ptr::null() } else { sys::ggml_backend_dev_description(device) };
        (!description.is_null()).then(|| CStr::from_ptr(description).to_string_lossy().into_owned())
    }
}

#[cfg(all(target_os = "windows", feature = "vulkan"))]
fn register_vulkan() {
    unsafe {
        if sys::ggml_backend_reg_by_name(c"Vulkan".as_ptr()).is_null() {
            // MSVC static builds can omit Vulkan during registry initialization.
            let backend = sys::ggml_backend_vk_reg();
            if !backend.is_null() {
                sys::ggml_backend_register(backend);
            }
        }
    }
}

#[cfg(not(all(target_os = "windows", feature = "vulkan")))]
fn register_vulkan() {}

const NEAR_TOKEN_LIMIT: i32 = 200;

/// Whether a stretch of at least SHORTEST_REPEAT characters follows itself straight away.
fn repeats_itself(text: &str) -> bool {
    let chars: Vec<char> = text.chars().chain([' ']).collect();
    (SHORTEST_REPEAT..=chars.len() / 2).any(|length| (0..=chars.len() - 2 * length).any(|start| chars[start..start + length] == chars[start + length..start + 2 * length]))
}

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

pub fn rank_languages(probes: &[Vec<f32>], count: usize) -> Vec<(String, f32)> {
    average(probes)
        .into_iter()
        .filter_map(|(id, probability)| Some((whisper_rs::get_lang_str(id as i32)?.to_string(), probability)))
        .take(count)
        .collect()
}

fn average(probes: &[Vec<f32>]) -> Vec<(usize, f32)> {
    let Some(width) = probes.iter().map(Vec::len).max() else {
        return Vec::new();
    };
    let mut ranked: Vec<(usize, f32)> = (0..width)
        .map(|id| (id, probes.iter().map(|p| p.get(id).copied().unwrap_or(0.0)).sum::<f32>() / probes.len() as f32))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked
}

#[cfg(test)]
mod language_tests {
    use super::average;

    #[test]
    fn averages_the_windows_and_ranks_the_languages() {
        let ranked = average(&[vec![0.1, 0.9, 0.0], vec![0.7, 0.3, 0.0], vec![0.1, 0.8, 0.1]]);
        assert_eq!(ranked.iter().map(|(id, _)| *id).collect::<Vec<_>>(), [1, 0, 2]);
        assert!((ranked[0].1 - 2.0 / 3.0).abs() < 1e-6);
        assert!(average(&[]).is_empty());
    }
}

#[cfg(test)]
mod speed_tests {
    use super::{audio_ctx_for, repeats_itself, threads_for};
    use crate::RATE;

    #[test]
    fn small_cpus_use_every_core_and_larger_ones_leave_one() {
        assert_eq!(threads_for(0), 1);
        assert_eq!(threads_for(2), 2);
        assert_eq!(threads_for(4), 4);
        assert_eq!(threads_for(6), 5);
    }

    #[test]
    fn the_encoder_covers_the_window_plus_a_margin() {
        assert_eq!(audio_ctx_for(5 * RATE), 750);
        assert_eq!(audio_ctx_for(5 * RATE + 1), 800);
        assert_eq!(audio_ctx_for(20 * RATE), 1500);
        assert_eq!(audio_ctx_for(60 * RATE), 1500);
    }

    #[test]
    fn finds_a_line_that_repeats_itself() {
        assert!(repeats_itself("Bitte bereitet bis dahin eure Zahlen vor. Bitte bereitet bis dahin eure Zahlen vor."));
        assert!(repeats_itself("ขอบคุณมากครับวันนี้อากาศดีขอบคุณมากครับวันนี้อากาศดี"));
        assert!(!repeats_itself("Ja, ja, ja. Nein, nein. Gut, danke, wir sehen uns morgen."));
        assert!(!repeats_itself(""));
    }
}

#[cfg(test)]
mod backend_tests {
    use super::selected_backend;

    #[test]
    fn reads_the_device_whisper_actually_initialized() {
        assert_eq!(selected_backend("whisper_backend_init_gpu: using Metal backend"), Some("Metal"));
        assert_eq!(selected_backend("whisper_backend_init_gpu: no GPU found"), None);
    }
}
