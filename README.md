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

The app comes without a speech model. On the first start, open Models and
download one for your language. They range from 78 MB to 3.1 GB, and the
recommended ones are listed first. The [user guide](docs/user-guide.md) walks
through the rest. Every version is on the
[releases page](https://github.com/mawiswiss/tlansclaib/releases).

## What it does

- Reads m4a, mp3, wav, flac, mp4 and most other audio and video files.
- Plays the recording along with the text and highlights the line you hear.
  Click a line and the recording jumps there.
- Timecodes on every line, switched on or off at any time.
- Lines can be corrected, speakers renamed and the text searched.
- Tells who speaks when, with an optional download of 38 MB.
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
offers models trained on exactly those languages, with a click: Thai from Mahidol University and from SCB 10X, Swiss
German that writes Standard German, and dedicated models for German, English
and French. Every download is checked against its checksum before the app uses
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

The app goes online for the downloads you start, and for four seconds when
you first open Models after a start, to measure how long a download would
take. That's it.

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

## Support

tlansclaib is an independent project. I build it in my own time, with no
company behind it, and it stays free, without ads or a subscription. If it
saves you time, a contribution helps me keep it maintained and improving.

[Support my work](https://donate.stripe.com/dRm14ne1O4In7b82t28AE00)
