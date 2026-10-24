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
    let out = std::env::temp_dir().join(format!("tlansclaib-english-{}.txt", std::process::id()));
    let transcribe = |language: &str, extra: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_tlansclaib-engine"))
            .args(["transcribe", "--model", &model, "--language", language, "--cpu"])
            .args(extra)
            .arg("--audio")
            .arg(&fixture)
            .arg("--output")
            .arg(&out)
            .output()
            .expect("the engine runs");
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        assert!(output.status.success(), "engine failed: {stdout}\n{}", String::from_utf8_lossy(&output.stderr));
        assert!(stdout.contains(r#"{"event":"step","step":"decode"}"#), "{stdout}");
        assert!(stdout.contains(r#""event":"done""#), "{stdout}");
        (std::fs::read_to_string(&out).unwrap(), stdout)
    };

    let (stamped, _) = transcribe("en", &[]);
    assert!(stamped.starts_with("[00:00:00.00 --> 00:00:05."), "{stamped}");
    assert!(stamped.to_lowercase().contains("quick brown fox"), "{stamped}");

    let (plain, _) = transcribe("en", &["--no-timestamps"]);
    assert!(!plain.starts_with('['), "{plain}");
    assert!(plain.to_lowercase().contains("quick brown fox"), "{plain}");

    let (_, events) = transcribe("de", &[]);
    assert!(events.contains(r#""language":"de""#), "{events}");
    assert!(events.contains(r#""heard":[{"code":"en","#), "{events}");
    let _ = std::fs::remove_file(&out);
}
