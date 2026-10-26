# Changelog

All notable changes to tlansclaib. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-10-26

### Fixed

- The better speaker detection starts on Windows PCs without the Visual C++ Redistributable, because the installer brings the Microsoft C++ runtime, and a PC without a Vulkan driver no longer shows a Windows error at start (windows, b7e8fb0)
- Speaker detection is checked before use: Speakers stay greyed out with a Download or Repair button while none works, and a run that fails while finding the speakers offers to transcribe without them (speakers, 0cde2a2)
- The app checks for a new version at every start and shows a found one as a notice with "Update and restart" (updates, c220a99)
- A model that a new version adds to the setup downloads only after a click, and the model it replaces is offered for deletion (models, de308b6)
- Every model has a short name of language and tier, such as Thai Compact or Universal Best, also in the history (models, f5517eb, c591641)
- Delete all downloaded models from the Models dialog, with the space it frees (models, cffaac7)
- Up to eight speakers get clearly different colours, and a transcript names at most eight (speakers, 4d7ed27)
- The speaker dot sits on the first line of a long line (transcription, 2743b60)
- Notice and error card actions are buttons coloured by what they do (notices, 1a38b2b)
- Memory and crash errors in plainer words (transcription, ecb8dcd)

## [0.3.0] - 2026-10-25

### Added

- Follow the transcript word by word during playback, with the playing word highlighted and a click on a word playing from there (transcription, 2216737, 3d7ebf9, 939459f)
- Split lines and change their speaker in the transcript (speakers, a5e1e6c)
- Fall back to a smaller installed model when free memory refuses a start, or offer a download, a run without speaker detection, or trying anyway (transcription, 1046b93)
- Use a better installed model of the same kind while free memory allows, and offer to download one that would fit (models, 6f5acf8)
- Skip models that crashed, stalled or ran out of memory on this computer until a run with them finishes (models, 2c7d8f3)
- Support Windows processors without AVX2 with an AVX and an SSE2 engine (windows, 24d7ca0)
- Show which engine transcription runs on, Metal, Vulkan or CPU, with the chip's name (models, 25c3af5)
- Mark edited transcripts in the history and warn before a rerun discards corrections (history, 3de8826)
- Choose the download format next to a labelled download button on the transcript (transcription, 121d538, 11adb1d)
- Mark the models a selected setup will download (models, 497ba71)

### Changed

- Transcription on the CPU encodes only as much audio as each line needs, 35 to 46% faster (transcription, ca6bcfd)
- Processors with up to four cores use every core (transcription, 1b1d4dd)
- Essential uses the better speaker detection, and Minimal adds the basic one (models, d2c5309, 195fb68)
- Minimal uses Small q8_0 instead of Tiny (models, dc728b0, 2dba14c)
- Essential uses the full-precision German model and a q8_0 French model instead of q5_0 (models, f2c2161, bd28667)
- Precise is recommended on 16 GB Windows computers and for downloads under 30 minutes, and long downloads get a "Longer download" chip (models, bfeaf7e)
- The rerun notice about lost corrections appears only for edited transcripts (transcription, 7ccb47b)
- Redesigned setup card header with a waveform showing how much detail each setup catches (models, 7bcf6de)

### Removed

- Models no setup uses: Tiny, Base, Small, Typhoon, the q5_0 German, French and large-v3 files, and the full large-v3-turbo (models, dc728b0, 12f514e)

### Fixed

- A run with no progress for 45 seconds stops with an error naming the step, or retries on the CPU when the graphics chip stops answering (transcription, 72b46c5)
- The better speaker detection sizes its memory to the recording, so long recordings no longer start without room for it (speakers, 6f0cd6a)
- Up to eight speakers get their own colour (speakers, 7b15851)
- The run view names the graphics chip instead of repeating Metal (transcription, 9733d59)
- A long details line in the transcript header no longer cuts off the info icon (transcription, 671a74d)

## [0.2.0] - 2026-10-24

### Added

- Update the app from GitHub releases, checked once a day on start unless turned off in About (app, 2c33526)
- Choose a setup, Precise, Essential or Minimal, that downloads the right models for the language in the background (models, 03c2f1e)
- Vulkan transcription engine on Windows, with the CPU engine kept for machines without a usable graphics chip or enough video memory (windows, 7aabacb)
- Detect brief speaker turns with Nemotron (speakers, d9e3cd0)
- Note when the recording is in another language and offer a restart in the language heard (transcription, 38188bc)
- Show the engine in use, retry a failed graphics chip start, report stage times, and check the decoded audio's memory before loading a model (transcription, c6dbc13)

### Changed

- Results stay in the app history until exported, and the text or subtitle file is created on request (transcription, adbca9a)

### Fixed

- Short replies stay separate lines (speakers, 2cf8144)
- Application errors show instead of failing silently (afd3652)
- The log file names files only and shows the home folder as `~` (app, f3b00f8)
- The add-file hint no longer points to a handover folder (models, 321306f)

## [0.1.0] - 2026-10-15

### Added

- Transcribe a recording on the user's own computer with whisper.cpp, with models downloaded or added as files and checked before use (d4ab002)
- Transcribe every audio track into one transcript, each track a speaker, with optional timecodes (engine, 522cf06)
- Tell speakers apart in a recording with one track, for a given number of people or detected (engine, ac66cfb)
- Download speaker detection on request, checked against pinned checksums (app, a15483e)
- Models for Swiss German, German, English, French and Thai, downloaded from this repository's releases (models, 061d9f4)
- Link model files where they lie instead of copying them (models, 5852ac9)
- Report free disk space and connection speed, and keep 1 GB free when downloading (models, eaf8a48)
- Keep a history of finished transcripts that notices a moved or changed file (history, 05156b8)
- Correct, rename and switch the timecodes of a transcript without overwriting edits made elsewhere (history, cade169)
- Play, search and correct transcripts in a redesigned window (ui, be70525)
- App icon (app, 0c9a0c4)

[0.3.1]: https://github.com/mawiswiss/tlansclaib/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/mawiswiss/tlansclaib/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mawiswiss/tlansclaib/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mawiswiss/tlansclaib/releases/tag/v0.1.0
