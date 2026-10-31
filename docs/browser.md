# Browser version

tlansclaib Lite runs the app in a desktop browser, with nothing to install and
nothing uploaded. It transcribes the first 10 minutes of a recording with one
model, Whisper large-v3 turbo in q4f16 through transformers.js on WebGPU, and
points to the desktop app for the rest. A browser without WebGPU or
`shader-f16`, and any phone, gets a page that says so (`unsupported` in
`src/lib/web/backend.ts`).

## Commands

```sh
pnpm dev:web      # http://localhost:1432, with the COOP and COEP headers
pnpm build:web    # dist-web/, what Cloudflare Pages serves
pnpm wasm         # src/lib/web/engine.wasm alone, needs the wasm32-unknown-unknown target
```

`dist-web/` is a static site, deployed by hand to Cloudflare Pages at
https://tlansclaib.marcwieland.name. `public-web/_headers` makes the page
cross-origin isolated there, as the dev server does, so it runs as tested.
Cloudflare Pages refuses files over 25 MiB. Its Web Analytics is on, which
counts visits without cookies. About in Lite promises no cookies, so keep it
that way.

The title, description, canonical URL, social tags and JSON-LD come from the
`webHead` plugin in `vite.config.ts`, so the desktop build carries none of
them. `public-web/` holds `robots.txt` and the icons.

## How it fits together

- `vite --mode web` sets `FEATURES` in `src/lib/ipc.ts` to the lite set and
  picks `webBackend()`. The desktop build leaves every web file out. Keep
  web-only imports behind `import.meta.env.MODE === "web"` itself, because a
  check on `FEATURES` does not let the bundler drop them.
- `web/engine-wasm` compiles the engine's `windows.rs` to a 32 KB wasm file
  with plain C exports, so lines are cut exactly as on the desktop.
- `src/lib/web/worker.ts` mirrors the run loop in `engine/src/main.rs`: the
  language check over the first three lines of 17 to 23 s, then one greedy
  pass per line. Fit-encoder, the temperature fallback, word timings,
  speakers and multi-track recordings are left out.
- The browser decodes the audio (`decodeAudioData` at 16 kHz), so the formats
  are the browser's. It mixes all tracks into one.
- History lives in IndexedDB, the model in OPFS. The browser forgets a
  recording when the page reloads, so a reopened transcript asks for it again.
- `src/lib/web/export.ts` ports the text, SRT and WebVTT export from Rust.
  Keep the two in step.

## Traps

- **Every file is pinned.** `src/lib/web/model.ts` holds the Hugging Face
  revision and the size and SHA-256 of each model file and of ONNX Runtime's
  wasm. A file is kept only when both match. Bumping
  `@huggingface/transformers` or `onnxruntime-web` means new pins.
- **ONNX Runtime's wasm comes from jsDelivr.** At 26.9 MB it is over Cloudflare
  Pages' 25 MiB file limit. It is checked like a model file.
- **Cache Storage refused the 370 MB encoder** in Chrome 152, the Claude
  desktop app's browser pane, with "Unexpected internal error". The files live
  in OPFS.
- **transformers.js 4.3.1 dropped `revision` when `AutoTokenizer` probed
  `tokenizer_config.json`** and asked for `resolve/main/`. The store answers by
  file path, and `env.fetch` returns 404 for everything else, so the page never
  fetches a model file it did not verify.
- **ONNX Runtime runs on one thread.** With its default thread pool, session
  creation inside the worker sometimes never finished, with no error, in the
  pane's Chrome 152. WebGPU does the heavy work, so one thread costs little.
- **The browser reads the whole file into memory** before it decodes, so files
  over 1 GB are refused with a pointer to the desktop app.
- **A file in Google Drive, iCloud Drive or Dropbox** that is not stored on the
  computer fails to read with `NotReadableError`. The run ends with a message
  that says so.
- **`navigator.deviceMemory` may exceed 8.** The pane's Chrome 152 reported 32. The
  memory check in `src/lib/web/guard.ts` refuses below the measured peak plus
  1 GB, and only warns where the value is missing.

## Measured, 2026-10-29

Chrome 152 (the Claude desktop app's browser pane) on an Apple M5 Max, with
`shader-f16`:

| Clip | Total | Load and language check | Transcribe |
|---|---|---|---|
| German, 61.1 s, Auto-detect | 10.6 s | 5.2 s | 5.3 s |
| German repeated, first 600 s of 733 s, model already loaded | 25.8 s | 1.0 s | 24.6 s |

The language check heard German at 99.9%. The transcript matched the spike's.
The download is 593 MB.

Not measured yet: a mid-range Windows laptop, Safari, Firefox, and a GPU
without `shader-f16`. The 10-minute cap stays only if that laptop transcribes
10 minutes in about 5.

## The spike, 2026-10-25

A browser version is only practical on WebGPU. On the CPU both browser
runtimes are about 6 to 12 times slower than the native engine, too slow for the
low-end Windows machines the app targets. On WebGPU, transformers.js
transcribed 61 s of German in 3.5 s, but on an Apple M5 Max GPU, and the
smallest setup peaked at 4245 MB across the tab and Chrome's GPU process,
against 1260 MB for the native engine. It also needs an ONNX export, which
the fine-tuned Thai and German models do not have yet. The GitHub release assets
cannot be fetched from a web page at all.

The spike is in `scripts/browser-spike/`, measured on 2026-10-25.

### Results

Both clips are synthesized speech: `engine/tests/fixtures/english.wav` (5.4 s,
one line) and a German text read by macOS `say -v Anna` (61.1 s, four lines
cut by `tlansclaib-engine split`). Each runtime gets the same lines. Times are
from the second of two runs in a fresh headless Chrome 156, native from a
single run of `tlansclaib-engine transcribe`. Peak memory is the
macOS footprint of the tab's renderer and of Chrome's GPU process. The CPU
runtimes use four threads, like the native column.

| Runtime, model | Load s | German s | s per audio minute | English s | Peak renderer / GPU MB |
|---|---|---|---|---|---|
| Native CPU, `--fit-encoder`, q5_0 | 8.1¹ | 9.3 | 9.2 | 1.1 | 1260, one process |
| Native Metal, q5_0 | 1.0¹ | 1.3 | 1.3 | 0.3 | not measured |
| whisper.cpp wasm, q5_0 | 0.6 | 115.4 | 113 | 13.4 | 2185 / 386 |
| whisper.cpp wasm, q8_0 | 0.9 | 100.9 | 99 | 11.2 | 3053 / 388 |
| transformers.js WASM, q8 / q8 | 2.1 | 53.6 | 53 | 14.5 | 3617 / 390 |
| transformers.js WebGPU, fp16 / q4 | 3.1 | 3.5 | 3.4 | 0.9 | 4944 / 3484 |
| transformers.js WebGPU, q4f16 / q4f16 | 1.4 | 3.6 | 3.5 | 0.5 | 2272 / 1973 |

¹ Native load includes language detection, which encodes the first three
lines at the full 30 s. The browser pages skip it.

The ONNX models are `onnx-community/whisper-large-v3-turbo`, written encoder /
decoder dtype, where q8 loads the `_quantized` files. Every model was served from localhost, so the load times leave
out the download. A user downloads 574 MB (q5_0), 874 MB (q8_0), 1.08 GB (ONNX
q8), 1.61 GB (ONNX fp16 / q4) or 563 MB (ONNX q4f16) once.

- **Transcripts.** All runtimes wrote the same English line, "the quick brown
  fox jumps over the lazy dog. This is a short test of the transcription
  engine.", and the same German apart from one spot. Every runtime heard
  "prüfen" as "rufen". q5_0, native and wasm, wrote "Donnerstag Nachmittag",
  the rest wrote "Donnerstagnachmittag". The wasm q5_0 text matches native
  q5_0 character for character.
- **whisper.cpp wasm** is whisper.cpp v1.8.3 built with emscripten 6.0.13,
  SIMD and pthreads, in a worker. `wasm/binding.cpp` sets the parameters of
  `Engine::decode`. The page fits `audio_ctx` to each line plus 10 s and
  decodes in full when a line repeats itself, as `Engine::transcribe` does. No
  line repeated. Fitting does help here: the 20.5 s line took 36.7 s to
  encode at the full 1500 positions, the 10.2 s line 20.9 s at 1050. But ggml
  on wasm SIMD is slow. ONNX Runtime's int8 WASM took 13 to 14 s per line,
  full 30 s encoder and decoding included. ggml took 34 to 37 s for the
  full-window encoder alone. Going from one thread to four
  made it only 2.1 times faster.
- **transformers.js** 4.3.1 with ONNX Runtime Web 1.31.0-dev, greedy, no
  timestamps. The export always encodes the full 30 s, and `generate` has no
  temperature fallback, so neither app setting carries over. q4f16 halves the
  memory of fp16 / q4 at the same speed and text.
- **GitHub release assets fail CORS.** From the cross-origin isolated page, a
  fetch of `releases/download/models-v1/ggml-thai-fast-q8_0.bin` fails: the
  302 from github.com sends no `Access-Control-Allow-Origin`. The asset host
  behind it answers range requests (206), but the page never gets there. A
  Hugging Face `resolve/main` URL works: both hops send
  `Access-Control-Allow-Origin`, and a range request returns 206.

### What this does not show

- **Modest hardware is untested.** Everything ran on an Apple M5 Max, with
  other work on the machine (load average 6 to 12 of 18 cores). The earlier
  wasm q5_0 trial took 185 s for the German clip, against 115 s in the final
  run. Read the ratios to native, not the absolute times. Whether an older
  Windows iGPU offers WebGPU with `shader-f16`, and how fast, needs a run on
  that hardware.
- **One renderer crash is unexplained.** The first whisper.cpp wasm run lost
  its tab ("Target closed") before any output. The same page then ran five
  times without one.
- **The fine-tuned models have no ONNX export.** WebGPU needs one per model,
  made from the Hugging Face source in `models.json` with Optimum, then
  quantized. Whether Optimum exports the Thai and German fine-tunes cleanly,
  and whether their text holds up after q4f16, is untested. The ggml files
  load in the wasm build as they are, but at CPU speed.
- **The task named `ggml-large-v3-turbo-q5_0.bin`, which is not in
  `models.json`.** The spike fetched it from the same Hugging Face folder as
  the listed q8_0, and also ran the listed q8_0. Its checksum matched.
- Storing a 0.5 to 1.6 GB model in the browser (Cache API, OPFS) and its quota
  were not tried, and neither were Firefox and Safari.

### Running it

Needs macOS (the memory sampling calls `footprint`), Chrome, Node, and [emsdk](https://github.com/emscripten-core/emsdk) for
the wasm build. Models, the build and audio stay outside the repository.

```sh
cd scripts/browser-spike && npm install
git clone --depth 1 --branch v1.8.3 https://github.com/ggml-org/whisper.cpp.git $WORK/whisper.cpp
source $EMSDK/emsdk_env.sh && wasm/build.sh $WORK/whisper.cpp $WORK/build
./make-german.sh $WORK/audio/german.wav && cp ../../engine/tests/fixtures/english.wav $WORK/audio/
tlansclaib-engine split --language de $WORK/audio/german.wav > $WORK/audio/german.lines.json
tlansclaib-engine split --language en $WORK/audio/english.wav > $WORK/audio/english.lines.json
node serve.mjs 8787 $WORK/models $WORK/audio $WORK/build &
./run-all.sh $WORK/results && node summarize.mjs $WORK/results
```

`$WORK/models` holds the two ggml files and the
`onnx-community/whisper-large-v3-turbo` folder: its JSON and text files at the
top, the `encoder_model_*` and `decoder_model_merged_*` files of each dtype
under `onnx/`. `cors.html` runs the CORS check through `run.mjs` the same way.
