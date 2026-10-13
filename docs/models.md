# Models

The app loads whisper.cpp model files, the `ggml-*.bin` format. Nothing else
loads: not the PyTorch weights on Hugging Face (`model.safetensors`, `.pt`),
not CTranslate2 folders, not ONNX. Every file passes a check before the app
accepts it, see below.

## Where models live

- macOS: `~/Library/Application Support/name.marcwieland.tlansclaib/models`
- Windows: `%APPDATA%\name.marcwieland.tlansclaib\models`

"Show models folder" in the models panel opens it.

## The list

`src-tauri/resources/models.json` is compiled into the app. Each entry:

| field | meaning |
|---|---|
| `id` | stable key, also the saved selection |
| `name`, `recommended` | what the panel shows |
| `languages` | `["all"]` for the stock models, `["th"]` locks the language to Thai |
| `file` | file name inside the models folder |
| `size_bytes`, `sha256` | checked after a download and when a file is added |
| `ram_gb` | memory the model needs while running, the guard adds 1 GB on top |
| `url` | download address, or `null` for a file the user adds |
| `architecture`, `quantization`, `source`, `license` | shown in the panel |

A `models.json` placed in the models folder overrides the built-in list entry
by entry (same `id` replaces, new ids are appended). This is how a new model
reaches a colleague without a new app version: send the file and a
`models.json` snippet.

Any other `ggml-*.bin` file in the folder is listed as a custom model, named
after the file.

## Checks

Every file, downloaded or added:

1. The header must be a whisper.cpp model: ggml magic plus plausible
   hyperparameters. The check names what a wrong file is (safetensors, GGUF,
   zip, audio).
2. A file for a list entry must match the entry's `size_bytes` and `sha256`.
   A download that fails is deleted. A wrong file offered to an entry is
   refused with the expected name, size and checksum.
3. A model for a non-English entry must be multilingual.

The engine checks the same header again when a run starts.

## The Thai models

Converted from biodatlab's Hugging Face releases with `scripts/convert-model.py`.
They are not downloadable in this format anywhere, so they travel with the
installer as files and are added through "Add file…".

| entry | file | size | SHA-256 |
|---|---|---|---|
| Thai (fast) | `ggml-thai-fast-q8_0.bin` | 874 MB | `e0894592a0a90014a22dd7675c9a001e7f9b8fa58c7fcef547e1ea9f45207042` |
| Thai (best quality) | `ggml-thai-best-q8_0.bin` | 1.66 GB | `a6a149bd28cfd240d3e7cb54253081f76ea360c169abf85cae3f13d179c35464` |

Thai (fast) is `biodatlab/distill-whisper-th-large-v3` (MIT), a fine-tune of
large-v3-turbo. Thai (best quality) is `biodatlab/whisper-th-large-v3-combined`
(Apache-2.0), a fine-tune of large-v3, several times slower on a CPU.

## Converting a Hugging Face Whisper model

Needs uv, git and cmake on the machine doing the conversion (once, not on the
end user's computer).

```bash
scripts/convert-model.py biodatlab/distill-whisper-th-large-v3 thai-fast
```

Downloads the model into the Hugging Face cache, clones whisper.cpp into
`~/.cache/tlansclaib-convert`, builds its quantize tool, writes
`models/ggml-thai-fast-q8_0.bin` and `models/ggml-thai-fast-q5_0.bin`, and
prints each file's size and SHA-256 as a `models.json` snippet. `--keep-f16`
also keeps the unquantized file, `--quant q8_0` limits the output.

q8_0 is close to the original quality at about half the size. q5_0 is a third
of the size and audibly worse on difficult audio. Pick by running the
engine on a known recording:

```bash
target/release/tlansclaib-engine transcribe --model models/ggml-thai-fast-q8_0.bin \
  --audio recording.m4a --output /tmp/check --language th
```

`ram_gb` for a new entry: run the engine on a few minutes of audio under
`/usr/bin/time -l` on macOS and read "maximum resident set size", then round up.

## Decoding notes

Measured on three minutes of a far-field Thai meeting recording, the same clip
shifted by 10 ms, 44 ms and 125 ms, so that only the window cuts move:

| model | decoding | text that changes between shifts |
|---|---|---|
| Thai (fast), q8_0 | greedy | 39 % |
| Thai (fast), q8_0 | beam search, 5 beams | 40 % |
| Thai (best quality), q8_0 | greedy | 50 % |
| Thai (best quality), q8_0 | beam search, 5 beams | 52 % |
| All languages (fast), q5_0 | greedy | 60 %, and half the text missing |

The transformers pipeline the project started from behaves the same: a 44 ms
shift changed 55 % of its output on this clip. So on hard audio the Thai
models are unstable by nature, two runs on the same recording can differ a
lot, and neither beam search nor a bigger model buys stability. The engine
decodes greedily, with the temperature fallback as the only retry, and the
distilled model is the recommended Thai entry because it is the most stable
of the set and three times faster than the large one. `--beam-size` stays
available on the engine's command line for experiments.

On the full 1 h 47 min meeting, Thai (fast) wrote 494 lines in 5 minutes on
an Apple M5 Max with a peak of 1.5 GB of memory and no swap. Three lines
contained a short phrase repeated nine or ten times, the loop the temperature
fallback is meant to catch. whisper.cpp detects loops by token entropy
(`--entropy-thold`, default 2.4); a higher value catches more loops at the
price of more retries, which are slower and noisier. Tune it with a Thai
reader, not by eye.
