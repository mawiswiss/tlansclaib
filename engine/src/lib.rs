#[cfg(feature = "whisper")]
pub mod audio;
pub mod model_file;
pub mod output;
pub mod protocol;
#[cfg(feature = "whisper")]
pub mod transcribe;
pub mod windows;

pub const RATE: usize = 16_000;
