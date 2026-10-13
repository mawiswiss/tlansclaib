# Design

## Goal

A desktop app for macOS and Windows that transcribes a recording on the user's
own computer. The user drops an audio file on the window, picks a model and a
language, watches the steps and the time estimate, and gets a text file next to
the recording. It runs on modest laptops, never takes the machine down, downloads
models on demand instead of shipping them, and shows system usage while it
works.

## Parts

```
engine/      Rust: decoding, windowing, whisper.cpp, the `tlansclaib-engine` binary
src-tauri/   Rust: the Tauri 2 app. Models, downloads, run supervision, guards, system stats
src/         React and TypeScript frontend
scripts/     model conversion, not shipped
```

### Why the engine is a separate process

whisper.cpp runs inside `tlansclaib-engine`, bundled as a Tauri sidecar. The app
starts it per run, reads JSON lines from its stdout, and kills it when memory
gets tight. A crash in the engine becomes an error in the window instead of a
vanished app. The same binary works from a terminal.

## The engine

- `audio.rs` decodes any supported file with symphonia (AAC-LC in MP4 or M4A,
  MP3, WAV, FLAC, ALAC, Vorbis), downmixes to mono and resamples to 16 kHz.
  HE-AAC is not supported and fails with a clear error.
- `windows.rs` splits the audio at quiet moments: 100 ms RMS frames, a cut at
  the quietest frame between 17 s and 23 s after the previous cut, windows under
  −45 dB dropped. Each window becomes one line of output. Thai, Chinese,
  Japanese, Korean and a few other scripts get 11 s to 15 s windows instead,
  because Whisper's tokenizer spends up to three times more tokens on them and
  whisper.cpp caps a segment at 220 tokens. A window over the cap would go
  through every temperature fallback and come back truncated.
- `transcribe.rs` loads the model once and runs one decoding pass per window:
  greedy sampling, no context from the previous window, the chosen language,
  temperature fallback when the decoder loops. The texts of a window's segments
  are joined into one line. Timestamps are the window bounds, because the
  fine-tuned Thai models do not emit usable timestamp tokens. With language
  `auto` the first three non-silent windows vote, then the language is fixed for
  the whole file.
- `output.rs` appends to `<stem>.txt` and `<stem>_timestamps.txt` after each
  window, so a cancelled run keeps what was done. The timestamped format is
  `[HH:MM:SS.ss --> HH:MM:SS.ss] text`.
- `model_file.rs` reads a whisper.cpp model header without loading the model
  and derives a label such as `large-v3-turbo, q8_0`. Anything else is
  rejected with a reason that names what the file is.

The binary prints one JSON object per line on stdout:

```
{"event":"step","step":"decode|load|transcribe|write"}
{"event":"audio","seconds":6427.3}
{"event":"model","device":"metal|cpu","threads":9,"language":"th","windows":323}
{"event":"line","start":0.0,"end":17.2,"text":"..."}
{"event":"progress","done":8,"total":323,"position":180.5}
{"event":"done","lines":323,"elapsed":615.2,"txt":"<path>","timestamps":"<path>"}
{"event":"error","message":"..."}
```

whisper.cpp's own log output goes to stderr. The engine lowers its own process
priority at start and uses all physical cores but one, so the computer stays
usable during a run.

## The app

- `models.rs`: the model list is the bundled `resources/models.json`, overridden
  entry by entry by an optional `models.json` in the models folder. Model files
  live in the app data folder under `models`. Downloads stream to a `.part`
  file and are renamed only after validation.
- `validate.rs`: no model file is accepted unvalidated. Every file passes the
  header check. A file for a list entry must also match the entry's size and
  SHA-256. See `models.md`.
- `run.rs`: starts the sidecar, forwards each event to the window, holds the
  child for cancel, keeps the machine awake for the duration.
- `guard.rs`: the safety rules as pure functions over numbers, fed by
  `sysinfo`. Before a run, available memory must cover the model's memory need
  plus 1 GB. Before a download, free disk must cover the file plus 500 MB.
  During a run the engine is stopped when available memory falls under 400 MB
  or swap has grown by more than 2 GB since the start.
- `system.rs`: CPU, memory, swap and the app's own memory, once a second, for
  the footer.

## The window

One window. A toolbar with the model and the language. A drop zone, which
turns into the run view: the four steps with their state, a progress bar with
the position in the recording, elapsed and remaining time and speed, the
transcript growing line by line, and a cancel button. When done: a summary,
the text, "Open folder", "Copy text", "Transcribe another". Errors say what
happened and what to do. A footer shows system usage. The models panel lists
every model with size, memory need and state, downloads with progress, adds a
file, deletes, and explains what a valid model file is.

## Later

Vulkan on Windows, the CoreML encoder on macOS, converting a Hugging Face model
inside the app, a remote model list, code signing, SRT export, translation to
English.
