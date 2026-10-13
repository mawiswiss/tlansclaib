use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Decode,
    Load,
    Transcribe,
    Write,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Step {
        step: Step,
    },
    Audio {
        seconds: f64,
    },
    Model {
        device: String,
        threads: usize,
        language: String,
        windows: usize,
    },
    Line {
        start: f64,
        end: f64,
        text: String,
    },
    Progress {
        done: usize,
        total: usize,
        position: f64,
    },
    Done {
        lines: usize,
        elapsed: f64,
        txt: PathBuf,
        timestamps: PathBuf,
    },
    Error {
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
    fn events_round_trip() {
        let event = Event::Line {
            start: 0.0,
            end: 17.2,
            text: "สวัสดี".into(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(serde_json::from_str::<Event>(&json).unwrap(), event);
    }
}
