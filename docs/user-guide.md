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

Speaker detection is an optional download of about 38 MB, at the top of the
models dialog. It tells who speaks when in a recording with one audio track,
such as a meeting room, and runs offline like the models. Once it is there,
"Speakers" in the settings row offers "Auto" or 2 to 6 people. Giving the
number is more reliable.

The small "Standard" next to "Speakers" can be switched to "Fast", which
takes about a third of the time and gets a few more speaker changes wrong.
Very short replies such as "yes" often go to the wrong person either way.
Detection runs on the processor: on a recent Mac about 2 to 4 minutes for a
25-minute call, and 10 minutes for a 107-minute meeting. A laptop with four
cores may take half an hour for two hours.

Calls need none of this when each side is on its own track. Screen and call
recordings often keep your microphone on one track and the computer's sound,
with the other people, on another. tlansclaib transcribes every track and
gives each line its speaker, such as
`[00:01:23.40 --> 00:01:38.10] Speaker 2: text`.

## Transcribe

1. Pick the model and the language in the row below the top bar. The Thai
   models fix the language to Thai. For the others "Auto" works well, and
   choosing the language is a little more reliable. The folder icon at the
   end of the row keeps the transcript next to the recording, the default,
   or puts it in a folder of your choice.
2. Drop the recording on the window, or click "Choose a file…". m4a, mp3,
   wav, mp4, flac and most other formats work. The recording waits with the
   settings it will use. Check them, change them in the row above if needed,
   then click "GO".
3. Watch the steps. The bar shows how far it is, the time elapsed and an
   estimate of the time left, which settles after the first minute. Lines
   appear below as they are recognised.

Cancel keeps the lines done so far in the file.

## The transcript

The transcript is `<recording>_transcript.txt`, one line per stretch of
speech, such as `[00:01:23.40 --> 00:01:38.10] text`. The icons at the top
right of the result show it in its folder, copy the text, transcribe the
recording again and close the result. The plus to the right starts the next
recording.

- Rename: click the pencil next to the title, or double-click it. The text
  file is renamed with it. The recording keeps its name.
- Play: the player above the text plays the recording, at 1×, 1.5× or 2×.
  Click a line to hear it from there. The line playing is highlighted.
- Search: the search field, or ⌘F and Ctrl+F, finds words in the text.
- Timecodes: the switch next to the search adds or removes the times in
  front of each line, in the file too, and is remembered for the next
  transcript.
- Speakers: with several speakers, their names sit above the text. Click a
  name to change it, for example to "Marc" and "Client". The file follows at
  once. A coloured dot on each line names its speaker when pointed at.
- Correct a line: point at it and click the pencil, or double-click its
  text. Enter or a click elsewhere saves it into the file, Escape cancels,
  and "Undo" shows for a few seconds. If the file was changed in another
  program in the meantime, the app does not overwrite it and says so.

When detection found the wrong number of people, "Wrong number?" next to the
names opens the dialog to transcribe again with another number. With one
speaker and detection installed, "More people in this audio?" does the same. The dialog takes the
settings the transcript used. Change the model, the language or the number of
people for this run, then "Transcribe again". It replaces the file and any
corrections in it.

## History

"History" at the top right lists every transcript with its date, length and
folder, with a search above it. Click one to open it, read from its text
file. The folder icon shows it in Finder or Explorer. The cross removes it
from the list and leaves the file. A transcript that moved shows "Locate…" to
point it to its new place. If only the transcript is gone and the recording
is still there, "Transcribe again" makes a new one. The same goes for a
recording that moved: the player offers "Locate…". When a chosen file has
different content than the one transcribed, the app asks first.

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
analytics. The app goes online only for a download you start, and for four
seconds when you first open Models after a start, to measure how long a
download would take.

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
