# tlansclaib

Transcribe a recording on your own computer. Drop an audio file on the window,
pick a model and a language, and get a text file next to the recording.
Nothing is uploaded anywhere.

Runs on macOS and Windows. Models are downloaded on first use or added from a
file, see `docs/handover.md` for installing and `docs/models.md` for models.

## Development

Requires Rust (stable), CMake, Node 22 and pnpm.

```bash
pnpm install
pnpm tauri dev
```

Tests: `cargo test --workspace` and `pnpm test`. Design notes are in
`docs/design.md`.

## Credits

- [Whisper](https://github.com/openai/whisper) by OpenAI, the speech model family.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) by Georgi Gerganov and
  contributors, the inference engine, via [whisper-rs](https://github.com/tazz4843/whisper-rs).
- Thai models by [biodatlab](https://huggingface.co/biodatlab), Mahidol University.

MIT licensed.
