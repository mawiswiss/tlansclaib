# Design

## Goal

A desktop app for macOS and Windows that transcribes a recording on the
user's own computer. The user picks a setup once, drops a recording on the
window, checks the recording language, watches the steps and the time estimate, and gets a
result in the app's private history. Text or subtitles are exported on request.
It runs on modest laptops, never takes the
machine down, downloads models on demand instead of shipping them, and shows
system usage while it works.

## Parts

```
engine/      Rust: decoding, line cutting, whisper.cpp, speakers, the `tlansclaib-engine` binary
src-tauri/   Rust: the Tauri 2 app. Models, downloads, runs, history, guards, system stats
src/         React and TypeScript frontend
scripts/     model conversion and the sidecar build, not shipped
```

whisper.cpp runs inside `tlansclaib-engine`, bundled as a Tauri sidecar. On
Windows, a second sidecar has the Vulkan backend, and two more run on
processors older than AVX2, see `docs/release.md`. The app checks its free GPU
memory before each run and chooses the CPU sidecar when it cannot use Vulkan. It
starts the chosen sidecar per run, reads JSON lines from its stdout, and kills
it when memory gets tight. A crash in the engine becomes an error in the window
instead of a vanished app. The same binary works from a terminal.
Before a run, the CPU sidecar estimates decoded audio memory from the file's
track durations. If Metal or Vulkan fails before the model is ready, the app
retries once on the CPU. The retry never starts after transcription begins.
An engine that sends no event and uses under 250 ms of CPU time and reads
under 4 MB from disk for 45 s is stuck, for instance on a graphics chip that
never answers. The app kills it. While the model loads on Metal or Vulkan
that counts as a failure and the CPU retry follows. Anywhere else the run
ends with an error that names the step. After a gap of over 5 s in the
once-a-second check, such as a sleeping computer, the 45 s start again.

## The engine

- `audio.rs` decodes any supported file with symphonia (AAC-LC in MP4 or
  M4A, MP3, WAV, FLAC, ALAC, Vorbis), downmixes to mono and resamples to
  16 kHz. HE-AAC is not supported and fails with a clear error. Every audio
  track is decoded on its own, because screen and call recorders such as
  CleanShot put the microphone and the computer's sound on separate tracks.
  Tracks are aligned by their first timestamp. A track that cannot be
  decoded is skipped with a warning, as long as one can.
- `windows.rs` cuts the audio into lines where people pause. It measures
  100 ms frames and sets the quiet level from the recording itself: the
  quietest 5% of what is audible, plus 30% of the way to the speech level,
  ignoring digital silence. A pause is at least 0.6 s below that level. A
  line ends at the first pause after 5 s. With none before 23 s, it ends at
  the longest breath of at least 0.2 s, and only without one at the quietest
  moment. Thai, Chinese, Japanese, Korean and a few other scripts stop at
  15 s, because Whisper's tokenizer spends up to three times more tokens on
  them and whisper.cpp caps a segment at 220 tokens. Silence between lines is
  left out, and windows under −45 dB are dropped. With several tracks, each
  track is cut on its own and the lines of all tracks run in order of their
  start (`split_tracks`), so a speaker's turn is one line and a reply that
  overlaps gets its own. `tlansclaib-engine split` prints where and why each
  line would end.
- `transcribe.rs` loads the model once and runs one decoding pass per line:
  greedy sampling, no context from the previous line, the chosen language,
  and temperature fallback when the decoder loops. A line's segments are
  joined into one text. Its times are the line's bounds, because the
  fine-tuned Thai models do not emit usable timestamp tokens. A
  multilingual model hears the first three lines of 17 s to 23 s, and their
  averaged language probabilities rank the languages. With language `auto`
  the first one is used for the whole file. A chosen language is kept, and the
  model event reports what was heard: a chosen language that is not spoken
  makes Whisper write in it, so the transcript turns into a translation. A
  line that uses 200 tokens or more logs a warning.
- Whisper encodes 30 s for every line, however short. With `--fit-encoder`
  the encoder covers the line plus 10 s (`audio_ctx`), and a line whose text
  repeats a stretch of 24 characters or more is decoded again in full. The
  app passes it on every CPU run. On the CPU the encoder is most of the work:
  on synthesized speech, 72 s of German and 79 s of Thai, four threads of an
  Apple M5 Max took 35 to 40% less time to transcribe, and the x86 AVX2 build
  under Rosetta 46% less. German matched the
  full run within the noise of a 60 ms shift. Thai lost one final character
  on one word in every shift. A margin of 1 or 5 s made both turbo models
  repeat lines, stock large-v3 did not.
- The engine uses every physical core up to four, otherwise one less. It
  runs at below-normal priority, so a dual-core laptop keeps a usable
  window.
- `output.rs` appends one line at a time to the output file, so a cancelled
  run keeps what was done. Each line starts with its times,
  `[HH:MM:SS.ss --> HH:MM:SS.ss] text`, unless `--no-timestamps` is given.
  With several speakers, the name follows: `Speaker 1: text`.
- `speakers/` tells the speakers apart in a recording with one audio track,
  for `--speakers auto` or a number of people, with one of two backends
  chosen by `--speaker-backend`. Each loads its C library at run time from
  `--speaker-models <folder>` (`libloading`), so the engine runs without
  them. A recording with several tracks skips detection and keeps one speaker
  per track. `tlansclaib-engine speakers --backend` prints the turns alone.
- `speakers/nemotron.rs`, the better backend: parakeet.cpp's C library runs
  the Nemotron 3 Diarization GGUF model, which reports turns for up to eight
  speakers. A given number caps the labels by keeping the most active
  speakers. The engine checks the model's size and SHA-256 before loading it.
  Short replies are kept even when that voice speaks only briefly in the whole
  recording.
- `speakers/sherpa.rs`, the basic backend: the structs mirror `c-api.h` of
  sherpa-onnx 1.13.8, the only version the app downloads. pyannote
  segmentation 3.0 finds the turns and 3D-Speaker CAM++ tells the voices
  apart, on the CPU. The settings and why:
  - The 10 s analysis window moves a tenth of its length at a time,
    sherpa-onnx's default. `--speaker-precision fast` moves a quarter: on a
    10-minute call 12 s instead of 33 s, with 2 of 29 long turns on the
    wrong side instead of none. A quarter also put a speaker change 1.4 s
    late in a 40-second clip. A fiftieth took 357 s and was no better.
  - Without a given number, voices closer than a distance of 1.0 count as
    one. sherpa-onnx's default of 0.5 split a call of three or four people
    into dozens, and 1.1 merged two voices.
  - A voice with under 10 s, and under 5% of all speech, goes to the nearest
    other speaker.
  - Interjections under a second came out right about a third of the time at
    every setting, so rapid exchanges are a limit of the models. Separate
    tracks avoid it.
- `speakers/mod.rs` turns either backend's turns into lines. The lines still
  come from `windows.rs`. A line takes the speaker heard most in it and is cut
  where the speaker changes, unless a part would be shorter than 0.3 s. Where
  two speak at once, a reply of 2 s or less keeps its span, otherwise the one
  already speaking keeps the line. Speakers are numbered in order of their
  first line.
- `model_file.rs` reads a whisper.cpp model header without loading the model
  and derives a label such as `large-v3-turbo, q8_0`. Anything else is
  rejected with a reason that names what the file is.

The binary prints one JSON object per line on stdout:

```
{"event":"step","step":"decode|speakers|load|transcribe|write"}
{"event":"audio","seconds":6427.3,"speakers":["Speaker 1","Speaker 2"]}
{"event":"speaker_progress","done":12,"total":40}
{"event":"speakers","speakers":["Speaker 1","Speaker 2","Speaker 3"]}
{"event":"loading","part":"device|language"}
{"event":"model","device":"metal|vulkan|cpu","device_name":"<GPU name>","threads":9,"language":"th","windows":323,"heard":[{"code":"th","probability":0.97}]}
{"event":"line","start":0.0,"end":17.2,"text":"...","speaker":1}
{"event":"progress","done":8,"total":323,"position":180.5}
{"event":"done","lines":323,"elapsed":615.2,"file":"<path>","timings":{"decode":4.2,"speakers":0.0,"load":2.1,"transcribe":608.7,"write":0.1}}
{"event":"error","message":"..."}
```

The `audio` event names the tracks' speakers, the `speakers` event those
found by detection. whisper.cpp's own log output goes to stderr. The engine
lowers its own process priority at start and uses all physical cores but
one, so the computer stays usable during a run.
The model event names the backend and GPU that whisper.cpp initialized, and
the three languages heard most, which an English-only model leaves out.
Between `load` and `model`, `loading` marks the start of the GPU or CPU
backend and each of up to three language probes, so no part of the load runs
long without an event.
The done event reports time spent decoding, finding speakers, loading the
model, transcribing, and writing. The sum can be lower than elapsed time
because progress reporting and other work are outside those stages.

## The app

- `models.rs`: the model list is the bundled `resources/models.json`,
  overridden entry by entry by an optional `models.json` in the models
  folder. An entry's `setups` names the setup modes it belongs to, and an
  override without it keeps the bundled modes. Model files live in the app data folder under `models`. Downloads
  stream to a `.part` file and are renamed only after validation. A file
  chosen for a list entry is copied into the folder. One added with "Add any
  model file…" is linked, not copied: `custom-models.json` in the models
  folder keeps its name and path. It is renamed and unlinked there,
  and the file stays where it is. Its chips come from the file header:
  architecture, quantization, and multilingual or English only. Its RAM is
  taken from a listed model of the same architecture and quantization, or
  estimated from the size, and shows with "≈". Files copied into the models
  folder by older versions still list as custom and can be deleted.
  `too-heavy.json` in the models folder keeps, per model id, why a model
  failed on this computer. Deleting or unlinking the model removes the entry.
- `detection.rs`: two speaker detections, each a download pinned by size and
  SHA-256, for Apple silicon, Intel Mac or Windows x64. Each stages in
  `<folder>.part` and is renamed once complete, and a `version.txt` ties it
  to the engine's version of it.
  - Basic, in `models/speaker-detection`, the folder of older versions: the
    sherpa-onnx 1.13.8 shared libraries from sherpa-onnx's GitHub release and
    the segmentation and voice models from Hugging Face. Only the libraries
    are copied out of the archive. About 38 MB to download, 62 MB on disk.
  - Better, in `models/speaker-detection-nemotron`: the parakeet.cpp 0.6.1
    library archive and the 201 MB Nemotron GGUF model. Only the library and
    its MIT licence are extracted. The model's OpenMDW 1.1 licence and origin
    notice are saved beside it.
- `cpu.rs`: which CPU engine the processor can run on Windows: the main one
  with AVX2, FMA, F16C and BMI2, the AVX one, or the SSE one. Every CPU run
  and helper call goes through it.
- `gpu.rs`: whether the computer can run the Precise model on its graphics
  chip, for the setup's recommendation. `tlansclaib-engine probe` starts the
  GPU whisper.cpp would pick and prints its backend, name and free memory, or
  null. On Windows the Vulkan sidecar answers, as before a run. A probe that
  hangs is killed after 10 seconds and counts as no GPU. Apple silicon is
  usable when Metal starts, an Intel Mac never, Windows when the model fits
  in the free memory.
- `validate.rs`: no model file is accepted unvalidated. Every file passes the
  header check. A file for a list entry must also match the entry's size and
  SHA-256. See `models.md`.
- `run.rs`: starts the sidecar, forwards each event to the window, holds the
  child for cancel and keeps the machine awake for the duration. The engine
  writes scratch text in app data. On completion or cancellation, the app saves
  the lines and run metadata to `transcripts/<id>.json` and removes the scratch
  file. A rerun replaces its history entry only after the new record is saved.
  A run's event loop acts only while the run state still holds that run's id,
  so late events of a cancelled or restarted engine go nowhere. A restart in
  another language kills the engine, drops its lines without a history entry,
  waits up to 3 s for the process to end so the memory check sees its memory
  free, and starts again with the same settings. Each step logs the seconds
  since the start, so a stuck run shows where it stopped.
  A model that fails while loading or transcribing, through a crash, a stall,
  the memory guard or an engine error before the language check, is marked too
  heavy (`too_heavy`), and the error adds that Automatic skips it from now on.
  A failure on Metal or Vulkan that the CPU retry follows marks nothing, and
  neither does an engine error in the language check or a failure while
  reading the audio or finding the speakers, which depend on the recording. A run with
  the model that finishes clears the mark.
- `stall.rs`: decides from the engine's events, CPU time and disk reads
  whether it is stuck, as a pure function with tests. The guard tick feeds it.
- `history.rs`: every finished run, and every stopped run with at least one
  line, lands in `history.json` in the app data folder, newest first, at most
  500 entries. It indexes the private JSON records. Each record also keeps its
  title, recording path, settings, speaker names and timed lines. The index
  keeps fingerprints from `fingerprint.rs`: the full SHA-256 of the record,
  and for the recording its size plus the SHA-256 of its first and last 4 MB.
  Opening an entry reports a changed record or a missing or changed recording.
  Removing an app record deletes its JSON file. Older text transcripts remain
  readable at their existing paths, with their separate `times/<id>.json` files.
  JSON keeps each result portable and lets the index be rebuilt on startup.
  At the 500-entry limit there is no query workload that calls for SQLite.
- `transcript.rs`: saves corrections, title changes and the timecodes display
  preference in private records. Exports text, SRT and WebVTT to a path chosen
  in the save dialog. Legacy text files keep their existing edit checks.
- `guard.rs`: the safety rules as pure functions over numbers, fed by
  `sysinfo`. Before a run, free memory must cover the model's memory need,
  or the speaker detection's when that is larger: 1.5 GB for the basic one, and
  for the better one 512 MB plus 512 KB per second of audio, about 3.9 GB for
  107 minutes. On top come an estimate of
  three copies of decoded 16 kHz audio, the in-memory transcript and 1 GB of
  headroom. Free disk must also cover scratch text, the private record and
  1 GB of headroom. If the file has no usable duration, the duration-based
  estimates are skipped and the live memory monitor still applies. Before a
  download or a copy into the models folder, free disk must cover the file
  plus 1 GB. Before a setup starts its downloads, free disk must cover all of
  them together plus 1 GB, so a full disk never ends with half a setup. During a run the engine
  is stopped when free memory falls under 400 MB or swap has grown by more
  than 2 GB since the start. A memory refusal at the start carries the
  largest model RAM that would start (`recording_budget`), with and without
  speaker detection, as a `memory` start error. `force` skips the start's
  memory checks only, never the disk check or the stop during a run.
- `system.rs`: CPU, memory, swap and the engine's memory, CPU time and disk
  reads, once a second, for the footer, the guard and the stall check. Free
  memory is total minus used. On macOS sysinfo's own "available" also counts
  pages apps are using.

## The window

One window, light or dark. It follows the system unless the switch in the
top bar picks one.

### Top bar and settings

- On the first start, with no setup saved and no model installed, the setup
  view takes the place of the drop zone and the settings row. See "Setup".
- The top bar holds the app name with "Offline processing", "History",
  "Models", the appearance switch and the About dialog. About lists the
  features, led by the statement that nothing leaves the computer, then who
  makes the app, the licence, the systems and how to support it.
- Updates have their own card in About, under the features
  (`UpdateSection.tsx`): the installed version and "Check for updates", then
  "Version X is available" with "Update and restart" and "What's new", which
  opens the release on GitHub. The card turns blue once a version is found.
  The download shows a bar. The install waits while a transcription or a
  download runs, and a failure links the release page. The switch "Check for
  updates on start" is on by default and checks at most once a day, rule in
  `lib/update.ts`.
- A found update also puts a blue button in the top bar, "Update to X", which
  follows the download and opens About at the card. While it shows, narrow
  windows drop "Offline processing" so the bar does not overflow.
- Before downloading, `update_blocker` refuses a Mac app started from the disk
  image or a translocated copy, which the update cannot replace, and too
  little free disk (`guard::can_update`). `docs/release.md` covers signing and
  `latest.json`.
- The settings row holds recording language ("Auto-detect" or a
  language), model and speakers
  in aligned cells. The language menu also lists a variant such as Swiss
  German once its model is installed, which runs the engine with `de`. The
  model starts at "Automatic", which names the chosen model's language in
  small text: the setup's model for the language when installed, otherwise
  one for all languages (`modelFor` in `lib/setup.ts`). It steps up to an
  installed catalog model of the same kind with a higher `quality` when that
  model fits the free RAM right now (`guard::model_budget`, sent with the
  system stats), the GPU is usable, and on Windows the model fits the GPU
  memory. A language's own model is never traded for one for all languages.
  The choice can change while other programs come and go. If the start check
  refuses the model for memory, see "Not enough memory" under "A run". When a better catalog model would fit but is not installed, a note
  below the row offers to download it (`betterDownload`). It never takes a
  model marked too heavy, which the menu lists with "(failed here)". Picking a
  model pins it, and a pinned single-language model fixes the language. It shows only before a transcription. Timecodes
  are not a setting there: the switch
  above a finished transcript decides and is remembered for the next.
- The model carries a fit label from `lib/fit.ts`: its listed RAM need
  against the computer's total RAM, green below 70%, orange below 90%, red
  above. It ignores what is in use right now, which the start check covers,
  so the label does not change while other programs come and go. A pinned
  model marked too heavy shows a red "Failed here" instead, with the reason in
  its tooltip.
- Menus (`Select.tsx`) are drawn by the app and follow the ARIA combobox
  pattern, a button with a listbox. Tab reaches them, the arrows, Home, End
  and Page Up or Down move, Enter or Space picks, typing jumps to a matching
  entry, Tab and a click outside close. Escape closes an open menu before the
  dialog around it.
- Tooltips render into the page body, so no scroll area or dialog edge cuts
  them off. Focus rings show for the keyboard only.

### A run

- A dropped or chosen recording does not start at once. The drop zone shows
  its name with the settings it will use as chips, which follow any change
  in the row above, and a large round "GO" button, also on Enter. That
  catches a wrong language or model before an hour of work. "Change file"
  picks another recording, the cross drops it, and the settings stay either
  way.
- The run view shows the steps side by side. Each icon lines up with its
  title, and the detail below never widens its step, so nothing moves while
  details change. In a narrow window the titles shorten ("Audio",
  "Speakers", "Model"). "Finding the speakers" shows a percentage, then the
  number of people. "Loading the model" shows its part: reading the file,
  starting up, the language check. Below, a progress bar with elapsed and
  remaining time and speed, and the transcript growing without moving the
  scroll position unless it is scrolled to the end.
- When the model hears another language than the chosen recording language,
  a note under the progress bar says so and offers "Restart in English". The
  heard language needs 60% or more and the chosen one under 10%
  (`lib/language.ts`). The note never stops the run, because the detection
  can be wrong, for instance with a dialect. The result keeps the note with
  "Transcribe again in English", which opens the dialog with that language.
- Errors say what happened and what to do. Where the app can fix the problem
  itself, the error card offers the fix as a button.
- Not enough memory: when the start check refuses the model, `launch` in
  `App.tsx` reads the `memory` start error. With "Automatic" it starts the
  best installed model that fits (`fittingInstalled`) once, with a notice
  and "Use … anyway". A pinned model, or no installed model that fits, ends
  on the error card with the fixes that apply: a smaller installed model, a
  download that fits (`fittingDownload`), which starts the recording once it
  is installed, no speaker detection when detection alone does not fit, and
  "Try anyway". Cancel stages the recording again.
- A run stopped for memory, a crash or a stall marks the model too heavy and
  sends `too_heavy`. The error card then offers the best installed model
  with less RAM.
- Notices (`Notices.tsx`) stack at the bottom right: info, warning and
  error, each optionally with buttons. Info without a button fades after
  8 s, the others stay until dismissed. App errors arrive here too.

### The result

- A card with icons for export, copy text, transcribe again and close, each
  named in a tooltip. Legacy text files also have a show in folder icon.
  Copying turns its icon
  into a green check. "Transcribe another" is a plus to the right of the
  card. Close and the plus both bring back the settings row and the drop
  zone.
- The title starts as the recording's name. The pencil or a double-click
  changes the title in the private record. The recording keeps its name.
  Legacy text files still rename with the title.
- One line of metadata: when, the length, the format ("MP4 video, 2
  tracks"), "3 people" after speaker detection, the model and the language.
  "2 tracks" counts the audio tracks of the file, "3 people" the voices
  detection found. The file name, the number of lines and the processing
  time sit in a tooltip.
- The player takes a full row above the text, at 1×, 1.5× and 2×. The row
  below holds the speakers on the left, and the search field (⌘F or Ctrl+F,
  Enter for the next match) and the timecodes switch on the right. The
  switch controls whether times are shown and included in text exports. It is
  disabled when no line times are known, and sets the default.
- Moving the player's position highlights the line there and scrolls it into
  view, also while paused. A click on a line plays from its start. The line
  playing stays in view unless the user scrolled in the last few seconds.
  With several tracks, lines overlap: every line under the playhead is
  marked, and the view follows the longest, so a short reply over a long turn
  does not pull it away. In a pause the line that just ended stays marked
  (`playingAt`).
- The recording plays through Tauri's asset protocol, whose scope starts
  empty: the app allows one file at a time when it shows it (`audio_source`).
  Videos play their sound only. A format the system player cannot play shows
  a note instead of the player.

### Speakers

- "Speakers" in the settings row offers "Disabled", which runs no detection,
  and with detection installed "Auto" and a number of people. The run uses the
  setup's detection when installed, otherwise the other one. The basic one
  offers 2 to 6 people and a small "Standard" or "Fast" choice in the label,
  the better one a cap of 2 to 8. Without detection, "Set up…" opens the
  models dialog at the speaker detections. Downloading switches the setting to
  "Auto", removing the last one back to "Disabled".
- With several speakers, a row above the text lists them with a colour each.
  Clicking a name renames it, and the file is saved with the new name in
  front of each of that speaker's lines, through the fingerprint check. The
  names live in the history entry (`speakers`), which is how a reopened file
  is read back: a line belongs to a speaker when it starts with that name and
  a colon. A name cannot be empty, hold a colon or be used twice. Every line
  carries its speaker's dot, which names the speaker when pointed at.
- With one speaker, the row says so, or "1 person detected" after detection.
  Without detection installed it offers "Set up speaker detection", with it
  "More people in this audio?". After detection with several people, "Wrong
  number?" follows their names. Both open the transcribe-again dialog with
  the number of people in focus.

### Corrections

Lines are corrected one at a time: the pencil or a double-click opens an
editor, Enter or blur saves, Escape cancels, and "Undo" stays for eight
seconds. A save sends all lines plus the fingerprint the app last saw. The
backend writes only when the file still has that fingerprint, then records
the new one in the history and returns it. Enter during an input method
composition, as with Thai, does not save. Timecodes are not editable, and
neither is the line structure, since merging or splitting lines would break
their link to the recording.

### History

History slides in from the right. Its cards keep one height, the list
scrolls, and a search sits above it. A click reads timed lines from a private
record. For older entries it reads the original text file and
`lib/transcript.ts` parses it: when every line starts with
`[HH:MM:SS.ss --> HH:MM:SS.ss]` it has timecodes, otherwise each line is
shown as written. A plain transcript takes its line times from the app data
when they are there. A missing older text file offers "Locate…". A missing
record can be transcribed again when the recording is available.

### Transcribing again

One dialog (`RerunDialog`) serves the icon on the result card, the history
and the speaker links. It is filled with the settings in the history entry:
the model by its id (`model_id`, or by name for older entries, or the first
installed one with a note when that model is gone), the recording language, the
speaker setting, its precision and its detection (`speaker_mode`,
`speaker_precision`, `speaker_backend`, where older entries count as the
basic one, and the current one runs when that is gone), and it keeps the
timecodes as they were. Each can be changed for this run only,
and the settings row stays as it is. A file with several tracks shows one
speaker per track instead of a choice. The run saves a new private record,
then replaces the old history entry. The dialog
says that it replaces the transcript and its corrections. Renamed speakers
start again as "Speaker 1" and so on.

### Setup

- `SetupView` asks for the language the user mostly transcribes and one of
  three setups. It is the first-start screen and the content of the Models
  dialog, which dims the window behind it.
  - Precise: the most accurate results, the biggest models and the better
    speaker detection.
  - Essential: mid-sized models and the better speaker detection.
  - Minimal: one small model for all languages and the basic speaker
    detection, for when the others do not run. Never recommended.
- A setup downloads the entries of `models.json` whose `setups` name it and
  that are for all languages or for the chosen language and variant, so
  German never brings the Swiss German model, plus its speaker detection
  (`wanted` in `lib/setup.ts`). The tables are in `docs/models.md`.
- Each setup shows what it still has to download and how long that takes at
  the measured speed. "Recommended for this computer" marks Precise when the
  graphics chip can run its model, the computer reports 14 GB RAM or more (a
  16 GB Windows PC reports less than 16), the model's RAM rates green and its
  downloads take less than 30 minutes. Otherwise it marks Essential, also
  offline or when Precise's model for the language is installed and marked too
  heavy (`recommend`). A setup whose downloads take 10 minutes or more
  carries a "Longer download" chip, orange, red from an hour. Nothing is
  selected while the check runs, then the marked setup is, unless the user
  already clicked one. Offline, the download button waits for "Try again".
- "Download and start" or "Apply" saves the setup in the settings and
  downloads in the background, one file at a time: the model for the setup's
  language first, so a transcription can start early, then speaker detection,
  then the rest. The disk check covers the whole set first. A line below the
  settings row shows the percentage, and a failure there offers "Try again".
  The queue resumes on the next start. Switching setups cancels downloads the
  new one does not want.
- Switching to a smaller setup deletes nothing by itself. The dialog offers
  to remove installed listed models and speaker detections the setup no
  longer wants, never custom or linked files.
- An existing user with models and no saved setup is not sent to the setup
  screen. The Models dialog opens with the details open.

### Models and details

- "Show models and details" under the setups is for technical users. It
  starts closed, except without a setup, and remembers its state. It shows
  what the app measured, the setup's models and speaker detection with
  purpose, file, size and status, and the full catalogue. Downloading from the
  catalogue adds to the setup (`added`), and removing takes out (`removed`),
  so the queue never fetches a file the user deleted.
- A card shows a short title for the trade-off, such as "Fast" or "Best
  quality", without the language its chip already shows (`title` in
  `models.json`, the full name stays for menus and the history). An "In your
  setup" chip marks the setup's members. While a setup other than the saved
  one is selected above, its members carry "Downloads with Precise" (or "In
  Precise" when installed) and the ones still to download are outlined, so
  the list shows what "Apply" will fetch.
- Then a link to the model page, a description of at most two lines, and
  chips for language, architecture, size, RAM and download time, coloured by
  `lib/fit.ts`. A model marked too heavy, listed or custom, leads with a red
  "Failed on this computer" chip that gives the reason.
  RAM: orange from 70% of total RAM, red from 90%, green when it fits. Size:
  orange when less than 10 GB would stay free, red when the model does not
  fit with 1 GB to spare, which also disables its button. Download: orange
  from 10 minutes, red from an hour. Only orange and red chips carry a
  tooltip, with context rather than the value again.
- The connection is measured for four seconds against the model server the
  first time the setup view shows, then kept for the session. Which files
  work is a tooltip on "Add any model file…".

### Footer

One line with CPU and RAM in whole numbers, their bars green, orange from
70% and red from 90%. Orange or red adds a warning sign whose tooltip says
what to do. During a run, the RAM figure adds "(Transcription uses 1 GB)",
the part the engine process holds. The copyright line on the right opens the
support dialog.

### Support

After the tenth finished transcription, a small dialog thanks the user and
asks for support. "Support my work" opens the Stripe donation page, "No,
thanks" closes it, and it asks again after every 25 more. One click on
"Support my work", here or in the About dialog, stops it for good. The counts
live in the settings and start from the finished transcripts already in the
history (`lib/support.ts`). ⌘⇧S on macOS or Ctrl+Shift+S on Windows opens it
at any time, for testing.

## Later

The CoreML encoder on macOS, a Windows signing
certificate, converting a Hugging Face model inside the app, a remote model
list, SRT export, translation into any language with a local language model,
and speaker detection within each
track, for calls where one track holds several people.
