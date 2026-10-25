#[cfg(feature = "whisper")]
pub mod audio;
pub mod model_file;
pub mod output;
pub mod protocol;
pub mod speakers;
#[cfg(feature = "whisper")]
pub mod transcribe;
pub mod windows;
pub mod words;

pub const RATE: usize = 16_000;
