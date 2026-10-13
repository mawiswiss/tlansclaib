use std::path::Path;

use anyhow::{Result, anyhow};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use crate::RATE;

pub struct Engine {
    context: WhisperContext,
    pub threads: usize,
    pub device: &'static str,
    pub decoding: Decoding,
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
        let path = model
            .to_str()
            .ok_or_else(|| anyhow!("the model path is not valid UTF-8"))?;
        let mut params = WhisperContextParameters::default();
        params.use_gpu(use_gpu);
        let context = WhisperContext::new_with_params(path, params).map_err(|error| {
            anyhow!(
                "cannot load the model {}: the file is damaged or incomplete ({error}). Delete it, then add or download it again.",
                model.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()
            )
        })?;
        let device = if use_gpu && cfg!(target_os = "macos") {
            "metal"
        } else {
            "cpu"
        };
        Ok(Engine {
            context,
            threads,
            device,
            decoding: Decoding::default(),
        })
    }

    pub fn is_multilingual(&self) -> bool {
        self.context.is_multilingual()
    }

    pub fn state(&self) -> Result<WhisperState> {
        Ok(self.context.create_state()?)
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
