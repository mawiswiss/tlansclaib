// Runs the built engine on a synthesized English clip. Needs a tiny model:
// TLANSCLAIB_TINY_MODEL=/path/to/ggml-tiny.bin cargo test -p tlansclaib-engine --test english
use std::path::PathBuf;
use std::process::Command;

#[test]
fn transcribes_the_english_fixture_with_the_tiny_model() {
    let Ok(model) = std::env::var("TLANSCLAIB_TINY_MODEL") else {
        eprintln!("skipped: set TLANSCLAIB_TINY_MODEL to a ggml-tiny.bin");
        return;
    };
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/english.wav");
    let out = std::env::temp_dir().join(format!("tlansclaib-english-{}", std::process::id()));
    let output = Command::new(env!("CARGO_BIN_EXE_tlansclaib-engine"))
        .args(["transcribe", "--model", &model, "--language", "en", "--cpu"])
        .arg("--audio")
        .arg(&fixture)
        .arg("--output")
        .arg(&out)
        .output()
        .expect("the engine runs");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "engine failed: {stdout}\n{}", String::from_utf8_lossy(&output.stderr));
    assert!(stdout.contains(r#"{"event":"step","step":"decode"}"#), "{stdout}");
    assert!(stdout.contains(r#""event":"done""#), "{stdout}");
    let text = std::fs::read_to_string(format!("{}.txt", out.display())).unwrap().to_lowercase();
    assert!(text.contains("quick brown fox"), "{text}");
    let stamped = std::fs::read_to_string(format!("{}_timestamps.txt", out.display())).unwrap();
    assert!(stamped.starts_with("[00:00:00.00 --> 00:00:05."), "{stamped}");
    let _ = std::fs::remove_file(format!("{}.txt", out.display()));
    let _ = std::fs::remove_file(format!("{}_timestamps.txt", out.display()));
}
