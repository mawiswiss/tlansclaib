# Design

## Goal

A desktop app for macOS and Windows that transcribes a recording on the user's
own computer. The user drops an audio file on the window, picks a model and a
language, watches the steps and the time estimate, and gets a text file next to
the recording. It runs on modest laptops, never takes the machine down, downloads
models on demand instead of shipping them, and shows system usage while it
works.

## Parts

```
engine/      Rust: decoding, windowing, whisper.cpp, the `tlansclaib-engine` binary
src-tauri/   Rust: the Tauri 2 app. Models, downloads, run supervision, guards, system stats
src/         React and TypeScript frontend
scripts/     model conversion, not shipped
```

### Why the engine is a separate process

whisper.cpp runs inside `tlansclaib-engine`, bundled as a Tauri sidecar. The app
starts it per run, reads JSON lines from its stdout, and kills it when memory
gets tight. A crash in the engine becomes an error in the window instead of a
vanished app. The same binary works from a terminal.

## The engine

- `audio.rs` decodes any supported file with symphonia (AAC-LC in MP4 or M4A,
  MP3, WAV, FLAC, ALAC, Vorbis), downmixes to mono and resamples to 16 kHz.
  HE-AAC is not supported and fails with a clear error. Every audio track is
  decoded on its own, because screen and call recorders such as CleanShot put
  the microphone and the computer's sound on separate tracks. Tracks are
  aligned by their first timestamp. A track that cannot be decoded is skipped
  with a warning, as long as one can.
- `windows.rs` splits the audio where people pause, so a line holds one
  stretch of speech. It measures 100 ms frames and sets the quiet level from
  the recording itself: the quietest 5% of what is audible, plus 30% of the
  way to the speech level, ignoring digital silence. A pause is at least
  0.6 s below that level. A line ends at the first pause after 5 s. With none
  before 23 s, or 15 s for Thai, Chinese, Japanese, Korean and a few other
  scripts, it ends at the longest breath of at least 0.2 s in that range, and
  only without any at the quietest moment. `tlansclaib-engine split` prints
  where and why each line of a recording would end. Those scripts
  stay short because Whisper's tokenizer spends up to three times more tokens
  on them and whisper.cpp caps a segment at 220 tokens. Silence between lines
  is left out, so a line starts when the speaking does, and windows under
  −45 dB are dropped. Speaker changes are not detected as such, but people
  pause when they hand over. Language detection still samples 17 s to 23 s
  windows. With several tracks, each track is split on its own and the lines
  of all tracks are transcribed in order of their start
  (`windows::split_tracks`), so a speaker's turn is one line and a reply that
  overlaps gets its own.
- `transcribe.rs` loads the model once and runs one decoding pass per window:
  greedy sampling, no context from the previous window, the chosen language,
  temperature fallback when the decoder loops. The texts of a window's segments
  are joined into one line. Timestamps are the window bounds, because the
  fine-tuned Thai models do not emit usable timestamp tokens. With language
  `auto` the first three non-silent windows vote, then the language is fixed for
  the whole file.
- `output.rs` appends one line per window to the output file, so a cancelled
  run keeps what was done. Each line starts with the window's time stamps,
  `[HH:MM:SS.ss --> HH:MM:SS.ss] text`, unless `--no-timestamps` is given.
  With several speakers, the speaker's name follows: `Speaker 1: text`. The
  `audio` event lists the names of the tracks, a `speakers` event the names
  found by speaker detection, and each `line` event carries its speaker.
- `speakers.rs` names who speaks in a recording with one audio track, with
  `--speakers auto` or a number of people and `--speaker-models <folder>`. It
  loads sherpa-onnx's C library at run time from that folder (`libloading`),
  so the engine runs without it. The structs mirror `c-api.h` of sherpa-onnx
  1.13.8, the only version the app downloads. pyannote segmentation 3.0
  finds the turns and 3D-Speaker CAM++ tells the voices apart, on the CPU.
  The 10 s analysis window moves a tenth of its length at a time,
  sherpa-onnx's default, or a quarter with `--speaker-precision fast`, the
  "Fast" choice next to "Speakers": on a 10-minute call 12 s instead of 33 s,
  with 2 of 29 long turns on the wrong side instead of none. A fiftieth took
  357 s and was no better. Interjections under a second came out right about
  a third of the time at every step, and also with shorter minimum durations
  for speech and gaps, so rapid exchanges are a limit of the models, not of a
  setting. Separate audio tracks avoid it. A quarter halved the work, but in a 40-second clip
  it put a speaker change 1.4 s late, so a short phrase went to the wrong
  person and the cut fell mid-sentence. Without a given number, voices
  closer than a distance of 1.0 count as one. The sherpa-onnx default of 0.5
  split a call of three or four people into dozens, and 1.1 merged the two
  voices of that clip. A
  voice with under 10 s, and under 5% of all speech, goes to the nearest
  other speaker. The lines still come from `windows.rs`. A line takes the
  speaker heard most in it and is cut where the speaker changes, unless a
  part would be shorter than 1 s. Where two speak at once, the one already
  speaking keeps the line. Speakers are numbered in order of their first
  line. A recording with several tracks skips detection and keeps one
  speaker per track. `tlansclaib-engine speakers` prints the turns alone.
- `model_file.rs` reads a whisper.cpp model header without loading the model
  and derives a label such as `large-v3-turbo, q8_0`. Anything else is
  rejected with a reason that names what the file is.

The binary prints one JSON object per line on stdout:

```
{"event":"step","step":"decode|speakers|load|transcribe|write"}
{"event":"audio","seconds":6427.3,"speakers":["Speaker 1","Speaker 2"]}
{"event":"speaker_progress","done":12,"total":40}
{"event":"speakers","speakers":["Speaker 1","Speaker 2","Speaker 3"]}
{"event":"model","device":"metal|cpu","threads":9,"language":"th","windows":323}
{"event":"line","start":0.0,"end":17.2,"text":"...","speaker":1}
{"event":"progress","done":8,"total":323,"position":180.5}
{"event":"done","lines":323,"elapsed":615.2,"file":"<path>"}
{"event":"error","message":"..."}
```

whisper.cpp's own log output goes to stderr. The engine lowers its own process
priority at start and uses all physical cores but one, so the computer stays
usable during a run.

## The app

- `models.rs`: the model list is the bundled `resources/models.json`, overridden
  entry by entry by an optional `models.json` in the models folder. Model files
  live in the app data folder under `models`. Downloads stream to a `.part`
  file and are renamed only after validation. Entries marked `featured` lead
  the panel, the rest sit in a closed "More models" section. A model file the
  user adds is linked, not copied: `custom-models.json` in the models folder
  keeps its name and path. It shows under "Custom models" with a "Custom"
  chip, can be renamed, and is unlinked rather than deleted, so the file stays
  where it is. Its chips come from the file header: architecture and
  quantization, multilingual or English only, which says what the vocabulary
  covers, not which language a fine-tune is good at. Its RAM is taken from a
  listed model of the same architecture and quantization, or estimated from
  the size, and shows with "≈". Files copied into the models folder by older
  versions still list as custom and can be deleted, since they are copies.
- `detection.rs`: speaker detection is an optional download of three files,
  each pinned by size and SHA-256: the sherpa-onnx 1.13.8 shared libraries
  for this computer from sherpa-onnx's GitHub release (Apple Silicon, Intel
  Mac or Windows x64), and the segmentation and voice models from Hugging
  Face. They land in `models/speaker-detection.part`, the libraries are
  copied out of the archive, nothing else, and the folder is renamed to
  `models/speaker-detection` once all is there. A `version.txt` ties it to
  the engine's sherpa-onnx version. About 38 MB to download, 62 MB on disk.
- `validate.rs`: no model file is accepted unvalidated. Every file passes the
  header check. A file for a list entry must also match the entry's size and
  SHA-256. See `models.md`.
- `run.rs`: starts the sidecar, forwards each event to the window, holds the
  child for cancel, keeps the machine awake for the duration. The transcript
  goes next to the recording or into the folder chosen behind the folder icon.
- `history.rs`: every finished run, and every stopped run with at least one
  line, lands in `history.json` in the app data folder, newest first, at most
  500 entries. A run that overwrites a file replaces that file's entry. Each
  entry keeps the paths of the transcript and the recording, and a
  fingerprint of each from `fingerprint.rs`: the full SHA-256 of the
  transcript, and for the recording its size plus the SHA-256 of its first
  and last 4 MB, fast even for long videos. Opening an entry reports a
  transcript changed outside the app and a recording that is missing or
  different. Either file can be pointed to a new place. A candidate whose
  content differs from the fingerprint needs a confirmation first. Entries
  from before fingerprints skip the check. The start and end of every line
  go to `times/<id>.json` next to `history.json`, so a transcript written
  without timecodes still plays along and can get them back. They are used
  only while the transcript's fingerprint matches, and go with the entry.
- `transcript.rs`: switches a finished file between the timecoded and the
  plain form when the switch changes. It refuses when the file no longer
  matches what the run wrote, so hand edits are never overwritten.
- `guard.rs`: the safety rules as pure functions over numbers, fed by
  `sysinfo`. Before a run, free memory must cover the model's memory need,
  or 1.5 GB for speaker detection when that is larger, plus 1 GB. Before a download or an added file, free disk must cover the
  file plus 1 GB. During a run the engine is stopped when free memory falls
  under 400 MB or swap has grown by more than 2 GB since the start.
- `system.rs`: CPU, memory, swap and the engine's memory, once a second, for
  the footer and the guard. Free memory is total minus used. On macOS
  sysinfo's own "available" adds up active, inactive and free pages, so
  memory apps are using counts as available and overlaps with used.

## The window

One window, light or dark: it follows the system unless the switch in the top
bar picks one.

- Top bar: the app name with "Offline processing", "History", "Models", the
  appearance switch and the About dialog. About has two parts: the features,
  led by the statement that nothing leaves the computer, and the app itself,
  who makes it, the license, the systems and how to support it.
- Settings strip: model, language ("Auto" or a language) and speakers, in
  one row of aligned cells, then a folder icon for where the transcript goes.
  Timecodes are not a setting before the run: the switch above a finished
  transcript decides and is remembered for the next. The icon holds a menu,
  "Next to the recording" or a chosen folder, turns blue for a chosen folder and names it
  in its tooltip. The row shows only before a transcription. While one runs
  or a result is shown it is hidden. The cross on the result card and
  "Transcribe another" both bring it back with the drop zone. The model
  carries a fit label from
  `lib/fit.ts`: its listed RAM need against the computer's total RAM, green
  below 70%, orange below 90%, red above. It ignores what is in use right now,
  which the start check covers, so the label does not change while other
  programs come and go.
- Menus (`Select.tsx`) are drawn by the app instead of the system and follow
  the ARIA combobox pattern: a button with a listbox. Tab reaches them, the
  arrows, Home, End and Page Up or Down move, Enter or Space picks, typing
  jumps to a matching entry, Tab and a click outside close. Escape closes an
  open menu first, before the dialog around it.
- Drop zone. A dropped or chosen recording does not start at once: the zone
  shows its name with the settings it will use as chips, which follow any
  change in the row above, and a large round "GO" button, also on Enter. The
  button keeps its size and stays round, and the zone scrolls in a short
  window instead. "Change file" under the name picks another recording, the
  cross drops it, and the settings stay either way. That catches a wrong language
  or model before an hour of work. Then the zone turns into the run view: the steps side by side. Each
  icon lines up with its title, and the detail below never widens its step,
  so nothing moves while details change. The transcribing step has none,
  the bar below shows the progress. With five steps in a narrow window the
  titles shorten ("Audio", "Speakers", "Model"). Then a
  progress bar with elapsed and remaining time and speed, and the transcript
  growing below without moving the scroll position unless it is scrolled to
  the end. When done: a summary card with four icons at its top right, show
  in folder, copy text, transcribe again and close, each named in a tooltip.
  Transcribe again opens its dialog, see below, and needs the recording
  where it was. Copying turns its
  icon into a green check and the tooltip into "Copied". "Transcribe another"
  is a square card with a plus to the right, named in a tooltip, since it is
  the next step for most. Below
  them, the text with its timecodes.
  Errors say what happened and what to do.
- The title of a result is the transcript's file name without
  `_transcript.txt`. The pencil or a double-click renames it, and the file on
  disk with it, as `<title>_transcript.txt` in the same folder
  (`rename_transcript`). The recording keeps its name. The rename refuses an
  existing file, characters that file names cannot hold, and a title over 120
  characters. A change in case only is allowed. The history entry follows the
  new path, and its fingerprint stays valid because the content is unchanged.
  The history lists transcripts by this title.
- A result shows one compact line of metadata: when, the length of the
  recording, its format ("MP4 video, 2 tracks", the container from the file
  extension, video when the engine saw a video track), "3 people"
  after speaker detection, the model and the language. "2 tracks" counts the
  audio tracks of the file, "3 people" the voices speaker detection found. The recording's file
  name, the number of lines and the processing time sit in a tooltip. Above
  the text, the player for the recording takes a full row (speeds 1×, 1.5×
  and 2×). The row below holds the speakers on the left, when there are
  several, and the search field (⌘F or Ctrl+F, Enter for the next match) and
  the timecodes switch on the right. The switch shows whether the file has
  timecodes, is disabled when no line times are known, and sets the
  default. With one speaker, the left side says so,
  or "1 person detected" after detection. Without speaker detection installed
  it offers "Set up speaker detection", which opens the models dialog at that
  card. With it installed it asks "More people in this audio?". After
  detection with several people, "Wrong number?" follows their names. Both
  open the transcribe-again dialog with the number of people in focus. Moving the player's
  position highlights the line there at once and scrolls it into view, also
  while paused. A click on a line plays from its start,
  and the line playing is highlighted and kept in view unless the user
  scrolled in the last few seconds. With several tracks, lines overlap: the
  highlight marks every line under the playhead, so both people show while
  they talk at once. The view follows the longest of them, so a short reply
  over a long turn does not pull it away, and in a pause the line that just
  ended stays marked (`playingAt`). The recording plays through Tauri's asset
  protocol, whose scope starts empty: the app allows one file at a time when
  it shows it (`audio_source`). Videos play their sound only. A format the
  system player cannot play shows a note instead of the player.
- "Speakers" in the settings row: "Disabled", which runs no detection, or
  with speaker detection installed "Auto" and 2 to 6 people, and a small
  "Standard" or "Fast" choice in its label. The history keeps the choice
  (`speaker_precision`) for transcribing again. Without it, "Set
  up…" opens the models dialog, where an "Optional" section offers the
  download. Downloading switches the setting to "Auto", removing it back to
  "Disabled". While it runs, "Finding the speakers" is a step of its own with
  a percentage, then the number of people.
- A recording with several audio tracks gets one speaker per track, named
  "Speaker 1", "Speaker 2" and so on. A row above the text lists them with a
  colour each. Clicking a name renames it, and the transcript file is saved
  with the new name in front of each of that speaker's lines, through the same
  fingerprint check as an edit. The names live in the history entry
  (`speakers`), which is how a reopened file is read back: a line belongs to a
  speaker when it starts with that name and a colon. A name cannot be empty,
  hold a colon or be used twice. In the text, every line carries its
  speaker's coloured dot, which names the speaker when pointed at. The names
  themselves stay in the row above.
- Lines can be corrected one at a time: the pencil or a double-click opens an
  editor, Enter or blur saves, Escape cancels, and "Undo" stays for eight
  seconds. A save sends all lines plus the fingerprint the app last saw. The
  backend writes only when the file still has that fingerprint, so an edit
  made in another program is never overwritten, then records the new
  fingerprint in the history and returns it. The same happens when the
  timecodes switch rewrites the file. Enter during an input method
  composition, as with Thai, does not save. Timecodes are not editable, and
  neither is the line structure, since merging or splitting lines would break
  their link to the recording.
- Footer: one line with CPU and RAM in whole numbers, their bars green, orange
  from 70% and red from 90%. Orange or red adds a warning sign whose tooltip
  says what to do. During a run, the RAM figure adds "(Transcription uses
  1 GB)", the part of it the engine process holds. The copyright line on the
  right opens the support dialog.
- Tooltips render into the page body, so no scroll area or dialog edge cuts
  them off.
- History slides in from the right. Its cards keep one height and the list
  scrolls, with a search above it. At most 500 entries, so the list stays
  light without paging. A click reads the
  original text file, no copy, and `lib/transcript.ts` parses it: when every
  line starts with `[HH:MM:SS.ss --> HH:MM:SS.ss]` it has timecodes, otherwise
  each line is shown as written. It then shows like a finished run, without
  counting as one. A plain transcript takes its line times from the app
  data when they are there, so it plays along and the switch can add the
  timecodes. A missing file offers "Locate…", and "Transcribe again"
  when the recording is still where it was.
- Transcribing again goes through one dialog (`RerunDialog`), from the icon
  on the result card, the history and the speaker links. It is filled with
  the settings in the history entry: the model by its id (`model_id`, or by
  name for older entries, or the first installed one with a note when that
  model is gone), the language, the speaker setting and its precision
  (`speaker_mode`, `speaker_precision`), and keeps the timecodes as they
  were. Each can be changed
  for this run only, and the row of defaults stays as it is. A file with
  several tracks shows one speaker per track instead of a choice. The run
  writes the same transcript path, passed to `start_run` as `output_file`,
  and replaces the entry. The dialog says that it replaces the transcript
  and its corrections whenever one exists. Renamed speakers start again as
  "Speaker 1" and so on.
- The models dialog dims the window behind it. "Recommended and installed"
  starts open, "For one language" and "More models" closed, and each toggles
  on its own. Speaker detection leads "Recommended and installed". A card
  shows a short title that names the trade-off, such as "Fast" or "Best
  quality", without the language its chip already shows (`title` in
  `models.json`, the full name stays for menus and the history). A blue
  "Recommended" chip, first among the chips, marks speaker detection, the fast all-language model as the
  best balance, and on a Mac with 16 GB RAM or more the large-v3 q5_0 model
  as the best quality for its download size, which also brings it into the
  first section. Its tooltip says why. Then a link to the model page, a
  description of at most two lines, and chips for language, size, RAM and
  download time, coloured by the rules in `lib/fit.ts`. RAM: the listed need
  against total RAM, orange from 70%, red from 90%. Size: orange when less
  than 10 GB would stay free, red when the model does not fit with 1 GB to
  spare, which also disables its button. Download: orange from 10 minutes, red
  from an hour. RAM is also green when it fits, size and download stay neutral
  unless orange or red. Only orange and red chips carry a tooltip, with
  context rather than the value again. Which files work is a tooltip on "Add
  any model file…". The connection is measured for four seconds against
  the model server the first time the dialog opens, then kept for the session.
- Focus rings show for the keyboard only, not after a mouse click.
- After the tenth finished transcription, a small dialog thanks the user and
  asks for support: "Support my work" opens the Stripe donation page, "No,
  thanks" closes it. It asks again after every 25 more. One click on "Support
  my work", here or in the About dialog, stops it for good. The counts live in
  the settings and start from the finished transcripts already in the history
  (`lib/support.ts`). To test it,
  ⌘⇧S on macOS or Ctrl+Shift+S on Windows opens it at any time. The About
  dialog has the same "Support my work" button.

## Later

Vulkan on Windows, the CoreML encoder on macOS, converting a Hugging Face model
inside the app, a remote model list, code signing, SRT export, translation to
English. Speaker detection within each track of a recording with several, for
calls where one track holds several people.
