use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{Result, bail};
use serde::Serialize;

const GGML_MAGIC: u32 = 0x67676d6c;
const HEADER_LEN: usize = 4 + 11 * 4;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ModelInfo {
    pub architecture: String,
    pub quantization: String,
    pub multilingual: bool,
    pub mel_bins: u32,
    pub audio_layers: u32,
    pub text_layers: u32,
    pub audio_state: u32,
}

impl ModelInfo {
    pub fn label(&self) -> String {
        format!("{}, {}", self.architecture, self.quantization)
    }
}

pub fn inspect(path: &Path) -> Result<ModelInfo> {
    let mut file = File::open(path)?;
    let mut header = vec![0u8; HEADER_LEN];
    let read = file.read(&mut header)?;
    header.truncate(read);
    parse(&header)
}

pub fn parse(header: &[u8]) -> Result<ModelInfo> {
    if header.len() < HEADER_LEN {
        bail!("{}", describe_other(header));
    }
    let word = |i: usize| u32::from_le_bytes(header[i * 4..i * 4 + 4].try_into().unwrap());
    if word(0) != GGML_MAGIC {
        bail!("{}", describe_other(header));
    }
    let n_vocab = word(1);
    let audio_state = word(3);
    let audio_layers = word(5);
    let text_layers = word(9);
    let mel_bins = word(10);
    let ftype = word(11);
    let plausible = (1..=100_000).contains(&n_vocab)
        && (64..=4096).contains(&audio_state)
        && (1..=64).contains(&audio_layers)
        && (1..=64).contains(&text_layers)
        && (mel_bins == 80 || mel_bins == 128);
    if !plausible {
        bail!("a ggml file, but not a whisper.cpp model");
    }
    let quantization = match ftype % 1000 {
        0 => "f32",
        1 => "f16",
        2 => "q4_0",
        3 => "q4_1",
        7 => "q8_0",
        8 => "q5_0",
        9 => "q5_1",
        _ => bail!("a whisper.cpp model with an unknown tensor type {ftype}"),
    };
    let size = match audio_state {
        384 => "tiny",
        512 => "base",
        768 => "small",
        1024 => "medium",
        1280 => "large",
        _ => bail!("a whisper.cpp model of an unknown size ({audio_state} audio state)"),
    };
    let mut architecture = size.to_string();
    if size == "large" {
        if mel_bins == 128 {
            architecture.push_str("-v3");
        }
        if text_layers == 4 {
            architecture.push_str("-turbo");
        } else if text_layers < audio_layers {
            architecture.push_str(&format!("-distil-{text_layers}"));
        }
    }
    Ok(ModelInfo {
        architecture,
        quantization: quantization.to_string(),
        multilingual: n_vocab >= 51865,
        mel_bins,
        audio_layers,
        text_layers,
        audio_state,
    })
}

fn describe_other(header: &[u8]) -> &'static str {
    if header.starts_with(b"GGUF") {
        return "a GGUF file (llama.cpp format), not a whisper.cpp model";
    }
    if header.starts_with(b"PK") {
        return "a zip archive or PyTorch checkpoint, not a whisper.cpp model";
    }
    if header.len() >= 8 {
        let json_len = u64::from_le_bytes(header[..8].try_into().unwrap());
        if json_len < 100_000_000 && header.get(8) == Some(&b'{') {
            return "a safetensors file (PyTorch weights), not a whisper.cpp model";
        }
    }
    if header.len() >= 8 && &header[4..8] == b"ftyp" {
        return "an audio or video file, not a model";
    }
    if header.starts_with(b"ID3") || header.starts_with(b"RIFF") || header.starts_with(b"fLaC") || header.starts_with(b"OggS") {
        return "an audio file, not a model";
    }
    "not a whisper.cpp model file"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(n_vocab: u32, audio_state: u32, audio_layers: u32, text_layers: u32, mels: u32, ftype: u32) -> Vec<u8> {
        let words = [
            GGML_MAGIC, n_vocab, 1500, audio_state, 20, audio_layers, 448, audio_state, 20, text_layers, mels, ftype,
        ];
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    #[test]
    fn recognises_large_v3_turbo_q8() {
        let info = parse(&header(51866, 1280, 32, 4, 128, 2007)).unwrap();
        assert_eq!(info.label(), "large-v3-turbo, q8_0");
        assert!(info.multilingual);
    }

    #[test]
    fn recognises_large_v3_f16_and_distilled() {
        assert_eq!(parse(&header(51866, 1280, 32, 32, 128, 1001)).unwrap().architecture, "large-v3");
        assert_eq!(parse(&header(51866, 1280, 32, 2, 128, 1001)).unwrap().architecture, "large-v3-distil-2");
    }

    #[test]
    fn recognises_english_only_tiny() {
        let info = parse(&header(51864, 384, 4, 4, 80, 1001)).unwrap();
        assert_eq!(info.architecture, "tiny");
        assert!(!info.multilingual);
    }

    #[test]
    fn names_what_a_wrong_file_is() {
        let safetensors = [&1234u64.to_le_bytes()[..], b"{\"__metadata__\":{}}" as &[u8]].concat();
        let safetensors = [safetensors, vec![0; 64]].concat();
        assert!(parse(&safetensors).unwrap_err().to_string().contains("safetensors"));

        let gguf = [b"GGUF" as &[u8], &[0; 60]].concat();
        assert!(parse(&gguf).unwrap_err().to_string().contains("GGUF"));

        let m4a = [&[0, 0, 0, 24][..], b"ftypM4A ", &[0; 60]].concat();
        assert!(parse(&m4a).unwrap_err().to_string().contains("audio or video"));

        assert!(parse(b"hello").unwrap_err().to_string().contains("not a whisper.cpp model"));
    }

    #[test]
    fn rejects_implausible_hyperparameters() {
        assert!(parse(&header(51866, 7, 32, 4, 128, 2007)).is_err());
        assert!(parse(&header(51866, 1280, 32, 4, 96, 2007)).is_err());
    }
}
