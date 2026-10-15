# tlansclaib

Transcribe recordings on your own computer, for macOS and Windows.

I had a meeting in Thai on a recording, 107 minutes long, and needed it as
text. A Python script on my Mac did that well. It also needed uv, Python,
PyTorch, ffmpeg and a terminal. Fine for me. Not something I could hand to a
colleague.

tlansclaib is that script turned into an app. Drop a recording on the window,
check the model and the language, press GO. The transcript lands as a text
file next to the recording. [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
does the work, on the GPU of a Mac and on the processor under Windows. Nothing
is uploaded anywhere.

> The recording never leaves your computer.

## What it does

- Reads m4a, mp3, wav, flac, mp4 and most other audio and video files.
- Thai, Swiss German, German, English and French get their own models. About
  100 more languages work with the general ones.
- Plays the recording along with the text and highlights the line you hear.
- Timecodes on every line, switched on or off at any time.
- Lines can be corrected, speakers renamed and the text searched.
- Tells who speaks when, with an optional download of 38 MB. A recording with
  one track per person gets one speaker per track without it.
- Keeps a history of every transcript.
- Stops a transcription before the computer runs out of memory, instead of
  freezing it.

## Install

Download the installer from the
[latest release](https://github.com/mawiswiss/tlansclaib/releases/latest).

On macOS 13 or newer, open the `.dmg` and drag tlansclaib into Applications.
The app is not signed with an Apple developer certificate, so macOS blocks the
first start. Open System Settings, then Privacy & Security, scroll down and
click Open Anyway. After that it starts normally.

On Windows 10 or 11, run the `.exe`. SmartScreen shows "Windows protected your
PC". Click "More info", then "Run anyway".

The app comes without a speech model. On the first start, open Models and
download one for your language. They range from 78 MB to 3.1 GB, and the
recommended ones are listed first. [docs/handover.md](docs/handover.md) walks
through the rest.

## Privacy

No account, no analytics, no tracking. The app goes online for the downloads
you start, and for four seconds when you first open Models after a start, to
measure how long a download would take. That's it.

> Once a model is there, the app works without internet.

## Build it yourself

You need Rust, CMake, Node 22 and pnpm.

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri build` builds the installer for your system. The tests run with
`cargo test --workspace` and `pnpm test`. How it fits together is in
[docs/design.md](docs/design.md). Adding or converting a model is in
[docs/models.md](docs/models.md), making a release in
[docs/release.md](docs/release.md).

## Credits

- [Whisper](https://github.com/openai/whisper) by OpenAI, the speech model family.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) by Georgi Gerganov and
  contributors, the inference engine, via [whisper-rs](https://github.com/tazz4843/whisper-rs).
- Thai models by [biodatlab](https://huggingface.co/biodatlab), Mahidol University,
  and [Typhoon](https://huggingface.co/typhoon-ai) by SCB 10X.
- Swiss German model by [gcoli](https://huggingface.co/gcoli), German by
  [primeline](https://huggingface.co/primeline), English by
  [distil-whisper](https://huggingface.co/distil-whisper), French by
  [bofenghuang](https://huggingface.co/bofenghuang).
- Speaker detection, an optional download:
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) by the k2-fsa team
  (Apache 2.0) on [ONNX Runtime](https://onnxruntime.ai) (MIT), with
  [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0)
  (MIT) and the CAM++ voice model of
  [3D-Speaker](https://github.com/modelscope/3D-Speaker) (Apache 2.0).

## Licence

MIT, see [LICENSE](LICENSE). Each model keeps its own licence, shown in the
app next to the model.

tlansclaib is free, with no ads and no subscription. It started as a script for
one meeting. If it saves you time too, a
[contribution](https://donate.stripe.com/dRm14ne1O4In7b82t28AE00) helps me keep
it going.
