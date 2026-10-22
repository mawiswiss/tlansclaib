use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Decode,
    Speakers,
    Load,
    Transcribe,
    Write,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Timings {
    pub decode: f64,
    pub speakers: f64,
    pub load: f64,
    pub transcribe: f64,
    pub write: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Step {
        step: Step,
    },
    Audio {
        seconds: f64,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        speakers: Vec<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        video: bool,
    },
    Model {
        device: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        device_name: Option<String>,
        threads: usize,
        language: String,
        windows: usize,
    },
    Line {
        start: f64,
        end: f64,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaker: Option<usize>,
    },
    Speakers {
        speakers: Vec<String>,
    },
    SpeakerProgress {
        done: usize,
        total: usize,
    },
    Progress {
        done: usize,
        total: usize,
        position: f64,
    },
    Done {
        lines: usize,
        elapsed: f64,
        file: PathBuf,
        #[serde(default)]
        timings: Timings,
    },
    Error {
        message: String,
    },
    Warning {
        message: String,
    },
}

pub fn emit(event: &Event) {
    let mut out = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut out, event);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_tagged_json_objects() {
        let json = serde_json::to_string(&Event::Step { step: Step::Decode }).unwrap();
        assert_eq!(json, r#"{"event":"step","step":"decode"}"#);

        let json = serde_json::to_string(&Event::Progress {
            done: 8,
            total: 323,
            position: 180.5,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"event":"progress","done":8,"total":323,"position":180.5}"#
        );
    }

    #[test]
    fn speaker_events_are_tagged_in_snake_case() {
        let json = serde_json::to_string(&Event::SpeakerProgress { done: 3, total: 40 }).unwrap();
        assert_eq!(json, r#"{"event":"speaker_progress","done":3,"total":40}"#);
        let json = serde_json::to_string(&Event::Step { step: Step::Speakers }).unwrap();
        assert_eq!(json, r#"{"event":"step","step":"speakers"}"#);
        let json = serde_json::to_string(&Event::Warning { message: "one track skipped".into() }).unwrap();
        assert_eq!(json, r#"{"event":"warning","message":"one track skipped"}"#);
    }

    #[test]
    fn events_round_trip() {
        let event = Event::Line {
            start: 0.0,
            end: 17.2,
            text: "สวัสดี".into(),
            speaker: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("speaker"));
        assert_eq!(serde_json::from_str::<Event>(&json).unwrap(), event);
        let event = Event::Line {
            start: 4.0,
            end: 9.5,
            text: "hello".into(),
            speaker: Some(1),
        };
        assert_eq!(serde_json::from_str::<Event>(&serde_json::to_string(&event).unwrap()).unwrap(), event);
    }
}
