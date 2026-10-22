# Using tlansclaib

## Install

Download the installer for your system:

- Mac, macOS 13 or newer, Apple silicon and Intel:
  [tlansclaib-mac.dmg](https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-mac.dmg).
  Open it and drag tlansclaib into Applications. Apple has checked the app,
  so it opens like any other.
- Windows 10 or 11:
  [tlansclaib-windows-setup.exe](https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-windows-setup.exe).
  Run it. SmartScreen shows "Windows protected your PC" once. Click "More
  info", then "Run anyway".

## Update

Open About, the "i" at the top right. Under Updates, press "Check for
updates". When there is a new version, "What's new" opens its release notes,
and "Update and restart" downloads it, installs it and starts it. On Windows a
small installer window shows the progress. Models, history and settings stay.

Once a new version is found, a blue "Update to …" button in the top bar shows
it and the download progress, and leads back to Updates.

"Check for updates on start" is on at first. The app then asks GitHub for the
newest version number once a day when it starts, and sends nothing else. Turn
it off, and the app checks only when you press the button.

An update waits while a transcription or a download runs. On a Mac the app
has to be in Applications. When an update fails, "Download from GitHub" leads
to the installers.

## Get a model

The app transcribes with a speech model, which is not part of the installer.
Open Models at the top right. "Recommended and installed" comes first, with
speaker detection at its top. "For one language" and "More models" open with
a click. Each card names its language in a chip.

- Thai: download "Fast", 874 MB. "Best quality" is 1.66 GB and takes about
  three times as long.
- Swiss German: the Swiss German model under "For one language". It writes
  what is said as Standard German.
- German, English or French alone: the matching model under "For one
  language". These are more accurate for their language than the general
  models.
- Any other language: "Fast" for all languages, 574 MB.

Chips show the size, the RAM a model needs and, before the download, how
long it takes. RAM is green when it fits. Orange and red mark a problem and
explain it when pointed at:

- RAM: orange when the model takes 70% of the computer's RAM or more, red from
  90%.
- Size: orange when less than 10 GB would stay free on the disk, red when the
  model does not fit, and then it cannot be downloaded.
- Download: orange from 10 minutes, red from an hour, at the speed measured
  the first time the dialog opens.

"Add any model file…" adds a whisper.cpp model from anywhere on the computer.
Its info sign tells which files work. The file stays where it is and is
listed under "Custom models". The pencil renames it, and the unlink icon
takes it off the list without touching the file. The bin of a downloaded
model deletes the file.

## Speaker detection

Speaker detection is an optional download of about 202 MB, at the top of the
models dialog. It tells who speaks when in a recording with one audio track,
such as a meeting room, and runs offline like the models. Once it is there,
"Speakers" in the settings row offers "Auto" or a cap of 2 to 8 people. Auto
estimates the number of voices. Giving a cap can suppress an extra label, but
cannot recover a voice the model missed. Short replies can still be assigned
to the wrong person. Detection speed depends on the computer and recording.

Calls need none of this when each side is on its own track. Screen and call
recordings often keep your microphone on one track and the computer's sound,
with the other people, on another. tlansclaib transcribes every track and
gives each line its speaker, such as
`[00:01:23.40 --> 00:01:38.10] Speaker 2: text`.

## Transcribe

1. Pick the model and the recording language in the row below the top bar.
   The Thai models fix the language to Thai. For the others, leave Recording
   language on "Auto-detect", which finds the language in most recordings.
   Choose one only when Auto-detect picks the wrong one.
2. Drop the recording on the window, or click "Choose a file…". m4a, mp3,
   wav, mp4, flac and most other formats work. The recording waits with the
   settings it will use. Check them, change them in the row above if needed,
   then click "GO".
3. Watch the steps. The bar shows how far it is, the time elapsed and an
   estimate of the time left, which settles after the first minute. Lines
   appear below as they are recognised.

When the model hears another language than the one chosen, a note says so
and offers to restart in that language. A wrong recording language makes the
model write in it, so the transcript would be a translation of what was said.
The note never stops the run, because the model can be wrong too, for
instance with a dialect. The finished transcript keeps the note, with a link
to transcribe it again.

Cancel keeps completed lines in the app's history.

## The transcript

The transcript stays in the app's history, with its line timing and recording
reference. Nothing appears beside the recording. Use Export to choose a file
when you need one: `.txt` for text, or `.srt` and `.vtt` for timed subtitles.
The other icons copy the text, transcribe the recording again and close the
result. The plus to the right starts the next recording.

- Rename: click the pencil next to the title, or double-click it. This changes
  the title in history. The recording keeps its name.
- Play: the player above the text plays the recording, at 1×, 1.5× or 2×.
  Click a line to hear it from there. The line playing is highlighted.
- Search: the search field, or ⌘F and Ctrl+F, finds words in the text.
- Timecodes: the switch next to the search shows or hides times and controls
  whether text exports include them. The app retains the line timing.
- Speakers: with several speakers, their names sit above the text. Click a
  name to change it. History saves the new name at once. A coloured dot on
  each line names its speaker when pointed at.
- Correct a line: point at it and click the pencil, or double-click its
  text. Enter or a click elsewhere saves it in history, Escape cancels,
  and "Undo" shows for a few seconds.

When detection found the wrong number of people, "Wrong number?" next to the
names opens the dialog to transcribe again with another number. With one
speaker and detection installed, "More people in this audio?" does the same. The dialog takes the
settings the transcript used. Change the model, the recording language or the
number of people for this run, then "Transcribe again". It replaces the result and any
corrections in history. Files you exported remain where they are.

## History

"History" at the top right lists every transcript with its date and length,
with a search above it. Click one to open it. The cross deletes an app record;
the app asks first and leaves the original recording and any exports alone.
Older `.txt` entries still open from their original paths. Their cross only
removes the history entry, and a moved text file can be located again. If a
record is missing and the recording is still there, "Transcribe again" makes
a new one. If the recording moved, the player offers "Locate…".

## The rest of the window

The three buttons in the top bar follow the system appearance, or pick light
or dark. The "i" tells what the app is and who makes it.

The model in the settings row is labelled "Fits", "Tight" or "Could
overload": what the model needs against the computer's total RAM, by the
same rule as in the models dialog.

The bar at the bottom shows the processor and the RAM, green below 70%,
orange from 70% and red from 90%. Orange and red add a warning sign that
tells what to do. During a transcription the processor is busy by design,
and the RAM figure adds how much of it the transcription uses.

## Privacy

Recordings and transcripts never leave the computer, and there are no
analytics. The app goes online only for a download you start, for four
seconds when you first open Models after a start, to measure how long a
download would take, and once a day on start to ask GitHub for the newest
version number, unless you turn that off under Updates in About.

## How long it takes

On a Mac with Apple silicon, a 1 h 47 min meeting took 5 minutes with the
Thai "Fast" model and 15 minutes with "Best quality". On a Windows laptop
without a compatible Vulkan GPU with enough free memory, expect roughly the
length of the recording with "Fast" and several times that with "Best quality".
The computer stays usable in the meantime.

## If something goes wrong

- "This transcription needs about X GB of free RAM": close other programs,
  pick a smaller model, or set Speakers to "Disabled". The app refuses to
  start rather than let the computer freeze, and stops a running
  transcription when memory gets dangerously low.
- A file that is "not a model": it is not a whisper.cpp model. The message
  names what the file is instead.
- A file that is not an audio file, or whose codec is not supported:
  convert the recording to MP3 or WAV with any audio tool and try again.
- The log file lives in `~/Library/Logs/tlansclaib/` on macOS and in
  `%LOCALAPPDATA%\tlansclaib\logs\` on Windows.
