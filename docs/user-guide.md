# Installing and using tlansclaib

## Install

**macOS:** open the `.dmg`, drag tlansclaib into Applications. The app is not
signed with an Apple developer certificate, so macOS blocks the first start.
Open System Settings, then Privacy & Security, scroll down and click "Open
Anyway", then confirm. After that it opens normally. Needs macOS 13 or newer.

**Windows:** run the `.exe` installer. SmartScreen shows "Windows protected your
PC": click "More info", then "Run anyway". Needs Windows 10 or 11.

## First start: get a model

The app transcribes with a speech model, which is not part of the installer.
Open "Models" in the top right.

- For Thai: "Download" on "Thai (fast)", 874 MB. "Thai (best quality)" is
  1.66 GB and takes several times longer per recording on a computer without
  a fast GPU.
- For Swiss German: "Download" on "Swiss German". It writes what is said as
  Standard German.
- For German, English or French alone: "Download" on the matching entry under
  "For one language". These are more accurate for their language than the
  stock models.
- For other languages: click "Download" on "All languages (fast)". It fetches
  574 MB once.

The panel lists the recommended models first. The sections "For one language"
and "More models" open with a click. Each model shows chips for its size, the
RAM it needs and, before it is installed, how long the download takes. RAM is
green when it fits. Orange and red mark a problem and explain it when pointed
at:

- RAM: orange when the model takes 70% of the computer's RAM or more, red from
  90%.
- Size: orange when less than 10 GB would stay free on the disk, red when the
  model does not fit, and then it cannot be downloaded or added.
- Download: orange from 10 minutes, red from an hour, at the speed measured
  the first time the dialog opens.

The link next to a name opens the model's page. The info sign on "Add any model
file…" tells which files work. A file added that way is used where it lies and
listed under "Custom models". The pencil renames it. The unlink icon takes it
off the list and leaves the file alone, while the bin of a downloaded model
deletes the file.

The "Optional" section offers speaker detection, about 38 MB. It names who
speaks when in a recording with one audio track, such as a meeting room, and
runs offline like the models. Once it is there, "Speakers" in the settings row
offers "Auto" or a number of people. Giving the number is more
reliable. The small "Standard" next to "Speakers" can be switched to "Fast",
which takes about a third of the time and gets a few more speaker changes
wrong. Very short replies such as "yes" are often given to the wrong person
either way. In calls, recording each side on its own track avoids that. Detection runs on the processor and takes time: on this Mac about 2
to 4 minutes for a 25-minute call and 10 minutes for a 107-minute meeting,
while the Mac was busy with other work. A laptop with four cores may take half
an hour for two hours.

## Transcribe

1. Pick the model and the language in the row below the top bar. The Thai models
   fix the language to Thai; for the others, "Auto" works well, and choosing
   the language is a little more reliable. The folder icon at the end of the
   row keeps the transcript next to the recording, the default, or puts it in
   a folder of your choice. While a transcript is shown, this row is hidden.
   The "Timecodes" switch next to the search above the text starts each line
   with its time in the recording, changes the file right away and is
   remembered for the next transcript. It is on by default. The cross at the top right of the result
   closes it and brings the row back. "Transcribe another", the plus to the
   right, does the same.
2. Drop the recording on the window, or click "Choose a file…". m4a, mp3, wav,
   mp4, flac and most other formats work. The recording waits with the
   settings it will use listed below its name. Check them, change them in the
   row above if needed, then click "GO".
3. Watch the steps. Once transcribing starts, the bar shows how far it is, the
   time elapsed and an estimate of the time left. The estimate settles after
   the first minute. Lines appear below as they are recognised. The list stays
   where it is scrolled. Scroll to its end to follow new lines.
4. When done, the folder icon at the top right of the result opens the folder
   with `<recording>_transcript.txt`, one line per stretch of speech, such as
   `[00:01:23.40 --> 00:01:38.10] text`. The icon next to it copies the text.
5. To rename a transcript, click the pencil next to its title, or double-click
   the title. The text file is renamed with it, to `<title>_transcript.txt` in
   the same folder. The recording keeps its name.
6. Screen and call recordings often keep your microphone on one track and the
   computer's sound, with the other people on the call, on another. tlansclaib
   transcribes every track and names each line's speaker, as in
   `[00:01:23.40 --> 00:01:38.10] Speaker 2: text`. The names above the text
   can be changed, for example to "Marc" and "Client". The file follows at
   once.

Cancel keeps the lines done so far in the same file.

"History" in the top right slides in a list of every transcript with its date,
length and folder. Click one to show it in the app, read straight from its
text file, with or without timecodes as it was saved. The folder icon shows it
in Finder or Explorer, the cross removes it from the list and leaves the file.
When a transcript is no longer where it was saved, the entry says so, and
"Locate…" points it to the file's new place. If the recording is still there,
"Transcribe again" makes a new transcript. The circular arrow at the top right
of an open transcript does the same. Both open a small dialog with the
settings that transcript used: change the model, the language, the number of
people or the timecodes there, for example when speaker detection found four
people where there were two, then "Transcribe again". It replaces the file and
any corrections in it. "Wrong number?" next to the speaker names opens the
same dialog.

Above a transcript, the recording can be played. Click a line to hear it from
there; the part playing is highlighted. The search field above the text, or
⌘F and Ctrl+F, finds words in the transcript. If the recording was moved, the
player says so and "Locate…" finds it again. When a chosen file has different
content than the one transcribed, the app asks before using it. Videos play
their sound only.

To correct a line, point at it and click the pencil, or double-click its text.
Enter or clicking elsewhere saves it straight into the text file, Escape
cancels, and "Undo" appears for a few seconds after each save. Timecodes stay
as they are. If the file was changed in another program in the meantime, the
app does not overwrite it and says so.

The three buttons next to it switch between following the system appearance,
light and dark. The "i" at the far right tells what the app is and who makes it.

The bar at the bottom shows the processor and the RAM. Their bars are green
below 70%, orange from 70% and red from 90%. When one is orange or red, a small
warning sign appears next to it, and pointing at it tells what to do. During a
transcription the processor is busy by design.

The model in the row below the top bar is labelled "Fits", "Tight" or "Could
overload", by the same RAM rule as in the models dialog. It compares what the
model needs with the computer's total RAM, so a model far too big for the
computer shows red no matter what else is open.

Nothing leaves the computer. Recordings and transcripts stay on it, there are
no analytics, and once a model is installed the app needs no internet at all.
It only goes online to download a model, and to measure the connection speed
when the models dialog opens, so it can show how long each download takes.

Memory used is what programs and the system hold, close to "Memory Used" in
the macOS Activity Monitor. Pointing at it shows how much is free.

## How long does it take

Measured on a 1 h 47 min meeting on a Mac with Apple silicon: "Thai (fast)"
took 5 minutes, "Thai (best quality)" 15 minutes. On a Windows laptop without
a fast graphics card, expect roughly the length of the recording with
"Thai (fast)" and several times that with "Thai (best quality)". The app shows
the live estimate, and the computer stays usable in the meantime.

## If something goes wrong

- "This transcription needs about X GB of free RAM": close other programs, pick
  a smaller model, or set Speakers to "Disabled". The app refuses to start rather than let the computer freeze,
  and stops a running transcription when memory gets dangerously low.
- "This file is a … file, not a model": the chosen file is not a whisper.cpp
  model. The expected file name and size are shown next to each entry.
- "Not an audio file" or a codec message: convert the recording to MP3 or WAV
  with any audio tool and try again.
- A log file for support lives at
  `~/Library/Logs/tlansclaib/` on macOS and
  `%LOCALAPPDATA%\tlansclaib\logs\` on Windows.

Nothing leaves the computer: the recording and the transcript stay on it.
