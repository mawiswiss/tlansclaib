# tlansclaib

Transcribe recordings on your own computer, for macOS and Windows. Nothing is
uploaded.

Drop a recording on the window, check the model and the language, press GO.
The transcript stays in the app's private history until you export it as text
or subtitles. The window shows it line by line, with the recording to play along.
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) does the work, on the
GPU of a Mac, on a compatible Windows Vulkan GPU with enough free memory, or on
the processor otherwise. On my Mac it runs about 20 times faster than the
recording plays.

## Download

- [tlansclaib for Mac](https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-mac.dmg),
  macOS 13 or newer, Apple silicon and Intel
- [tlansclaib for Windows](https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-windows-setup.exe),
  Windows 10 or 11

On a Mac, open the disk image and drag tlansclaib into Applications. On
Windows, run the installer. SmartScreen asks once, because the installer is
not signed. Click "More info", then "Run anyway".

The app comes without a speech model. On the first start it asks for the
language you mostly transcribe and one of three setups, Precise, Essential or
Minimal, and marks the one that suits the computer. The models download in the
background. The [user guide](docs/user-guide.md) walks
through the rest. Every version is on the
[releases page](https://github.com/mawiswiss/tlansclaib/releases), and the app
updates itself from there. It checks at every start and offers a new version
with one click.

## Requirements

- Mac: macOS 13 or newer, Apple silicon or Intel. Apple silicon transcribes on
  the graphics chip, an Intel Mac on the processor.
- Windows: Windows 10 or 11, 64-bit. A graphics card with Vulkan support and
  enough free memory does the work, otherwise the processor. Older and
  low-end processors run on engines of their own, more slowly.
- Memory: 8 GB, and 16 GB with a graphics chip for Precise. With less, the
  memory check stops many runs before they start.
- Disk: about 2 GB free for Minimal, 5 GB for Precise.

Without a graphics chip, a recording takes about as long as it plays with
Thai Compact, and several times that with Thai Best.

## What it does

- Reads m4a, mp3, wav, flac, mp4 and most other audio and video files.
- Plays the recording along with the text and highlights the word you hear.
  Click a word and the recording plays from there.
- Timecodes on every line, switched on or off at any time.
- Lines can be corrected, speakers renamed and the text searched.
- Tells who speaks when, offline, for up to eight people.
- Keeps a history of every transcript, and transcribes a recording again with
  other settings when the first try was off.
- Exports text, SRT or WebVTT files when you choose a destination.

## What it does better

Most transcription services upload your recording to their servers and charge
a subscription for it. tlansclaib does everything on your computer. A model is
downloaded once, and from then on the app works offline. No account, no
tracking, nothing to pay.

> The recording never leaves your computer.

Whisper's general models cover about 100 languages at once. For some of them
that shows. Thai is one. Swiss German isn't even on the list. tlansclaib
offers models trained on exactly those languages: Thai Compact and Thai Best
from Mahidol University, Swiss German that writes Standard German, a dedicated model for German, and a
faster one for English. Every download is checked against its checksum before the app uses
it.

Calls get their speakers right. A call recorded with one track per person
gives every line the right speaker, with no guessing. For a meeting room on a
single track, speaker detection tells the voices apart, offline as well.

Corrections are safe. A save only writes when the file is still the one the
app last saw, so an edit made in another program is never overwritten.

It also stays out of your way. Before a run, the app checks that the model
fits into the free memory. While it runs, it stops before the computer runs
out instead of freezing it. The engine runs at a lower priority, so the
computer stays usable.

## Privacy

The app goes online for the downloads of your setup, for four seconds on the
first start or when you first open Models after a start, to measure how long a
download would take, and at every start and once a day while open to ask
GitHub for the newest version number, which About can turn off. That's it.

> Once a model is there, the app works without internet.

## How it started

A friend came over and asked me to "tlansclaib" a company meeting in Thai.
That's where the name comes from. A Python script on my Mac did the job well,
but it needed uv, Python, PyTorch, ffmpeg and a terminal. Fine for me. Not something I could hand to a friend.
tlansclaib is that script turned into an app anyone can install.

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
- Thai models by [biodatlab](https://huggingface.co/biodatlab), Mahidol University.
- Swiss German model by [gcoli](https://huggingface.co/gcoli), German by
  [primeline](https://huggingface.co/primeline), English by
  [distil-whisper](https://huggingface.co/distil-whisper), Persian by
  [givia](https://huggingface.co/givia).
- Basic speaker detection, in the Minimal setup:
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) by the k2-fsa team
  (Apache 2.0) on [ONNX Runtime](https://onnxruntime.ai) (MIT), with
  [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0)
  (MIT) and the CAM++ voice model of
  [3D-Speaker](https://github.com/modelscope/3D-Speaker) (Apache 2.0).
- Better speaker detection, in the Precise and Essential setups:
  [Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization)
  by NVIDIA (OpenMDW 1.1), converted to GGUF by
  [mudler](https://huggingface.co/mudler/Nemotron-3-Diarization-GGUF), with the
  [parakeet.cpp](https://github.com/mudler/parakeet.cpp) runtime (MIT).

## Licence

MIT, see [LICENSE](LICENSE). Each model keeps its own licence, shown in the
app next to the model.

## Support

tlansclaib is an independent project. I build it in my own time, with no
company behind it, and it stays free, without ads or a subscription. If it
saves you time, a contribution helps me keep it maintained and improving.

[Support my work](https://donate.stripe.com/dRm14ne1O4In7b82t28AE00)
