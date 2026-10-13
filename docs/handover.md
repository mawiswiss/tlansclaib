# Installing and using tlansclaib

## Install

**macOS:** open the `.dmg`, drag tlansclaib into Applications. The app is not
signed, so the first start needs a right-click on the app, then Open, then Open
again in the dialog. After that it opens normally. Needs macOS 13 or newer.

**Windows:** run the `.exe` installer. SmartScreen shows "Windows protected your
PC": click "More info", then "Run anyway". Needs Windows 10 or 11.

## First start: get a model

The app transcribes with a speech model, which is not part of the installer.
Open "Models…" in the top right.

- For Thai: click "Add file…" on "Thai (fast)" and choose
  `ggml-thai-fast-q8_0.bin` from the handover folder. "Thai (best quality)"
  works the same with `ggml-thai-best-q8_0.bin`, and takes several times
  longer per recording on a computer without a fast GPU.
- For other languages: click "Download" on "All languages (fast)". It fetches
  574 MB once.

The panel shows the memory each model needs. A model that needs more memory
than the computer has is marked.

## Transcribe

1. Pick the model and the language in the top bar. The Thai models fix the
   language to Thai; for the others, "Detect automatically" works well, and
   choosing the language is a little more reliable.
2. Drop the recording on the window, or click "Choose a file…". m4a, mp3, wav,
   mp4, flac and most other formats work.
3. Watch the steps. Once transcribing starts, the bar shows the position in the
   recording, the time elapsed and an estimate of the time left. The estimate
   settles after the first minute. Lines appear as they are recognised.
4. When done, "Show in folder" opens the folder with the two files:
   `<recording>_transcript.txt` with the text and
   `<recording>_transcript_timestamps.txt` with a time stamp per line.

Cancel keeps the lines done so far in the same files.

## How long does it take

Measured on a 1 h 47 min meeting: "Thai (fast)" took 5 minutes on a Mac with
Apple silicon. On a Windows laptop without a fast graphics card, expect
roughly the length of the recording with "Thai (fast)" and several times that
with "Thai (best quality)". The app shows the live estimate, and the computer
stays usable in the meantime.

## If something goes wrong

- "This model needs about X GB of free memory": close other programs or pick a
  smaller model. The app refuses to start rather than let the computer freeze,
  and stops a running transcription when memory gets dangerously low.
- "This file is a … file, not a model": the chosen file is not a whisper.cpp
  model. The expected file name and size are shown next to each entry.
- "Not an audio file" or a codec message: convert the recording to MP3 or WAV
  with any audio tool and try again.
- A log file for support lives at
  `~/Library/Logs/name.marcwieland.tlansclaib/` on macOS and
  `%LOCALAPPDATA%\name.marcwieland.tlansclaib\logs\` on Windows.

Nothing leaves the computer: the recording and the transcript stay on it.
