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
newest version number at every start and once a day while it stays open, and
sends nothing else. A new version shows as a notice with "Update and
restart". Turn it off, and the app checks only when you press the button.

An update waits while a transcription or a download runs. On a Mac the app
has to be in Applications. When an update fails, "Download from GitHub" leads
to the installers.

## Set up

The app transcribes with speech models, which are not part of the installer.
On the first start it asks two things:

- The language you mostly transcribe. Thai, Swiss German, German, English and
  French have models of their own, which come along. "Several languages" takes
  only the model for all languages.
- A setup:
  - Precise: the most accurate results, with the biggest models and the better
    speaker detection. For a computer with a graphics chip and 16 GB RAM.
    About 3.3 GB, more with a language of its own.
  - Essential: mid-sized models and the better speaker detection, for older
    computers or a slower connection. About 1.1 GB.
  - Minimal: one small model for all languages and the basic speaker
    detection, for when the others do not run. About 300 MB.

The app measures the connection, checks for a graphics chip and marks one
setup "Recommended for this computer". A bar rates the computer from 0 to
100%: green runs well, orange is slow, red very slow. Until the first
transcription of a minute or more it is an estimate from the graphics chip
and the memory, then it uses how fast transcriptions really ran. If the Precise model failed on this
computer before, Essential is recommended instead. A download of 10 minutes or
more shows a "Longer download" chip on the setup. Precise stays recommended up to 30
minutes, because the models download once. Any setup can be chosen. "Download and
start" fetches the models in the background, the model for your language
first, and a line below the settings shows how far it is. A transcription can
start as soon as the first model is in.

Models at the top right opens the same choice later. Switching to a smaller
setup deletes nothing by itself: the dialog offers to remove the models no
longer in it.

When an update of the app brings a new model for your setup, a notice names
it and its size and asks before it downloads. Once it is in, a notice offers
to delete the model it replaces. "Delete all models" at the bottom of Models
deletes every downloaded model and speaker detection and frees the space they
take. Your transcripts stay, and you choose a setup again.

### Models and details

"Show models and details" below the setups is for technical users. It shows
what the app measured, every model and speaker detection in your setup with
its file and status, the full list of models and both speaker detections, and
your own model files. Downloading a model from the list adds it to your
setup, and the bin takes one out. While you pick another setup above, the
models it would download are outlined and marked "Downloads with" and the
setup's name.

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

Speaker detection tells who speaks when in a recording with one audio track,
such as a meeting room, and runs offline like the models. Precise and
Essential bring the better one, Minimal the basic one:

- Better detection, about 202 MB, which keeps short replies apart.
  "Speakers" offers "Auto" or a cap of 2 to 8 people. A cap can suppress an
  extra label, but cannot recover a voice the model missed.
- Basic detection, about 38 MB. In the other setups it runs only when the
  better one is not installed. "Speakers" in the settings row offers "Auto"
  or 2 to 6 people, and giving the number is more reliable. The
  small "Standard" next to "Speakers" can be switched to "Fast", which takes
  about a third of the time and gets a few more speaker changes wrong. Very
  short replies such as "yes" often go to the wrong person. Detection runs on
  the processor: on a recent Mac about 2 to 4 minutes for a 25-minute call,
  and 10 minutes for a 107-minute meeting.

Calls need none of this when each side is on its own track. Screen and call
recordings often keep your microphone on one track and the computer's sound,
with the other people, on another. tlansclaib transcribes every track and
gives each line its speaker, such as
`[00:01:23.40 --> 00:01:38.10] Speaker 2: text`.

When speaker detection cannot start on this computer, "Speakers" reads "Not
working". The app then checks its files against the download. When one is
missing or damaged, a "Repair" button deletes it and downloads it again. When
the files are fine, downloading them again would not help, so there is no
"Repair". If the other speaker detection is not installed yet, "Download"
offers it instead. Otherwise transcriptions run without speaker names, and
the tooltip gives the reason. A recording waiting to start keeps its "GO" off
until a download is done, and a notice says whether detection works now.

## Transcribe

1. Check the recording language in the row below the top bar. Leave it on
   "Auto-detect", which finds the language in most recordings, and choose one
   only when Auto-detect picks the wrong one. The model is "Automatic": it
   takes your setup's model for the language, such as the Swiss German model
   for Swiss German, and otherwise the model for all languages. When a
   better model of the same kind is installed and fits the free memory right
   now, it takes that one instead, but only on a computer with a usable
   graphics chip. If a better one would fit but is not installed, a note
   below the row offers to download it. Its cross hides the note for that
   model. Pick a model there to use it
   instead. A model that ran out of memory, stopped
   responding or crashed on this computer is taken by Automatic only when no
   other installed model can transcribe the language.
   The menu lists it with "(failed here)" and Models with a red "Failed on
   this computer" chip. Pick it to try again: once a transcription with it
   finishes, Automatic takes it again. When transcriptions take longer than
   the recording itself, or before the first one the computer has no usable
   graphics chip and very little memory, a warning below the row says they
   run very slowly here. It links to a smaller setup, or on Minimal suggests
   closing other programs. Its cross hides it for good.
2. Drop the recording on the window, or click "Choose a file…". m4a, mp3,
   wav, mp4, flac and most other formats work. The recording waits with the
   settings it will use: the model, the recording language and the speaker
   detection. Check them, change them in the row above if needed,
   then click "GO".
3. Watch the steps. The bar shows how far it is, the time elapsed and an
   estimate of the time left, which settles after the first minute. Next to
   it, the app says how long the step usually takes on this computer. When a
   step runs well past that, or past what the recording's length suggests, a
   note under the bar names both times. The transcription carries on and may
   still finish. If it seems stuck, "Start over" runs it again from the
   beginning with the same settings. The note also says what else helps for
   that step, such as a smaller model when there is one. Lines appear below
   as they are recognised.

When the model hears another language than the one chosen, a note says so
and offers to restart in that language. A wrong recording language makes the
model write in it, so the transcript would be a translation of what was said.
The note never stops the run, because the model can be wrong too, for
instance with a dialect. The finished transcript keeps the note, with a link
to transcribe it again.

Cancel keeps completed lines in the app's history.

## The transcript

The transcript stays in the app's history, with its line timing and recording
reference. Nothing appears beside the recording. The line below the title
names when, how long, the file type, the recording language, the model and,
after speaker detection, which detection and how many people. Click Download .txt to save
it as a text file. The arrow next to it picks another format: `.srt` and `.vtt`
subtitles, for a transcript with line times. The icons next to it copy the text, transcribe the recording again
and close the result. The plus to the right starts the next recording.

- Rename: click the pencil next to the title, or double-click it. This changes
  the title in history. The recording keeps its name.
- Play: the player above the text plays the recording, at 1×, 1.5× or 2×.
  Click a line to hear it from there, or a word to hear it from that word.
  The line playing is highlighted, and in it the word being spoken.
- Search: the search field, or ⌘F and Ctrl+F, finds words in the text.
- Timecodes: the switch next to the search shows or hides times and controls
  whether text exports include them. The app retains the line timing.
- Speakers: with several speakers, their names sit above the text. Click a
  name to change it. History saves the new name at once. A coloured dot on
  each line names its speaker when pointed at. Click the dot to give the line
  another speaker, or "New speaker" for a person detection missed. With one
  speaker, "Add a speaker" next to it does the same.
- Correct a line: point at it and click the pencil, or double-click its
  text. Enter or a click elsewhere saves it in history, Escape cancels,
  and "Undo" shows for a few seconds.
- Split or join lines: while correcting a line, Enter with the cursor inside
  the text splits it there. The second part goes to the next speaker and
  starts at the time of its first word. A transcript made before word times
  shares the line's time by the length of each part. Backspace at the start
  of a line joins it to the line above.

When detection found the wrong number of people, "Wrong number?" next to the
names opens the dialog to transcribe again with another number. With one
speaker and detection installed, "More people in this audio?" does the same. The dialog takes the
settings the transcript used. Change the model, the recording language or the
number of people for this run, then "Transcribe again". It replaces the result in
history. Files you exported remain where they are. After a correction, the dialog
warns that the corrections will be lost, and its button reads "Discard corrections
and transcribe".

## History

"History" at the top right lists every transcript with its date and length,
with a search above it. A transcript you corrected carries an "Edited" label.
Click one to open it. The cross deletes an app record;
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
same rule as in the models list. A model that failed on this computer is
labelled "Failed here", and its tooltip says why.

The bar at the bottom shows the processor and the RAM, green below 70%,
orange from 70% and red from 90%. Orange and red add a warning sign that
tells what to do. During a transcription the processor is busy by design,
and the RAM figure adds how much of it the transcription uses.

## Privacy

Recordings and transcripts never leave the computer, and there are no
analytics. The app goes online only for the downloads of your setup or one
you start, for four seconds on the first start or when you first open Models
after a start, to measure how long a download would take, and at every start
and once a day while open to ask GitHub for the newest version number, unless
you turn that off under Updates in About.

## How long it takes

On a Mac with Apple silicon, a 1 h 47 min meeting took 5 minutes with Thai
Compact and 15 minutes with Thai Best. On a Windows laptop without a
compatible Vulkan GPU with enough free memory, expect roughly the length of
the recording with Thai Compact and several times that with Thai Best.
The computer stays usable in the meantime.

## If something goes wrong

- Not enough free memory for the model: with "Automatic", the app takes the
  best installed model that fits and says so in a notice, with a button to
  use the first model anyway. With a model you picked, or when no installed
  model fits, the window offers what helps: a smaller installed model, a
  smaller model to download, which then starts the transcription by itself,
  transcribing without speaker detection, or "Try anyway". When the model is
  already the smallest one, it says so and suggests closing other programs.
  Even then the
  app stops a running transcription when memory gets dangerously low, so the
  computer does not freeze.
- A transcription stopped because memory ran low, or the model crashed or
  stopped responding: the window offers to transcribe again with the next
  smaller installed model, or to download one. When there is none, it says
  the model is the smallest and offers "Start again" for after you closed
  other programs.
- A file that is "not a model": it is not a whisper.cpp model. The message
  names what the file is instead.
- A file that is not an audio file, or whose codec is not supported:
  convert the recording to MP3 or WAV with any audio tool and try again.
- The log file lives in `~/Library/Logs/tlansclaib/` on macOS and in
  `%LOCALAPPDATA%\tlansclaib\logs\` on Windows.
