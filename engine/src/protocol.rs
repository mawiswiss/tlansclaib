use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub use crate::words::Word;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Decode,
    Speakers,
    Load,
    Transcribe,
    Write,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LoadPart {
    Device,
    Language,
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
pub struct Heard {
    pub code: String,
    pub probability: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Step {
        step: Step,
    },
    Loading {
        part: LoadPart,
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
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        heard: Vec<Heard>,
    },
    Line {
        start: f64,
        end: f64,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaker: Option<usize>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        words: Vec<Word>,
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
        let json = serde_json::to_string(&Event::Loading { part: LoadPart::Language }).unwrap();
        assert_eq!(json, r#"{"event":"loading","part":"language"}"#);
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
            words: Vec::new(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("speaker") && !json.contains("words"));
        assert_eq!(serde_json::from_str::<Event>(&json).unwrap(), event);
        let event = Event::Line {
            start: 4.0,
            end: 9.5,
            text: "hello".into(),
            speaker: Some(1),
            words: vec![Word { start: 4.0, end: 9.5, text: "hello".into() }],
        };
        assert_eq!(serde_json::from_str::<Event>(&serde_json::to_string(&event).unwrap()).unwrap(), event);
    }

    #[test]
    fn the_model_event_names_what_the_model_heard() {
        let event = Event::Model {
            device: "cpu".into(),
            device_name: None,
            threads: 4,
            language: "de".into(),
            windows: 12,
            heard: vec![Heard { code: "en".into(), probability: 0.97 }],
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.ends_with(r#""heard":[{"code":"en","probability":0.97}]}"#), "{json}");
        assert_eq!(serde_json::from_str::<Event>(&json).unwrap(), event);
        let older = r#"{"event":"model","device":"cpu","threads":4,"language":"de","windows":12}"#;
        assert!(matches!(serde_json::from_str::<Event>(older).unwrap(), Event::Model { heard, .. } if heard.is_empty()));
    }
}
