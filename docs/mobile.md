# Mobile app

The same app runs on iPhone and Android, and its features belong to Free.
It transcribes on the iOS Simulator and the Android emulator: pick a
recording, press GO, get a timed transcript in the history. On a real iPhone
it opens to the setup screen, and no transcription has run there yet. Nothing
is on a store.

This page describes how the shared code behaves on phones. The phone
projects, their build and the store releases live in the private Pro
repository, so building this repository gives the desktop app and the
browser version only.

The browser version is no route to phones: its model peaked at 4.2 GB, which
a mobile tab does not get (`docs/browser.md`).

## How it differs from the desktop

- **The engine is a thread of the app.** iOS starts no other process.
  `engine/src/run.rs` holds the run loop the binary and the app share, and
  `src-tauri/src/worker.rs` starts it as a sidecar on the desktop or as a
  thread on a phone. Cancel, restart and the memory guard set a stop flag that
  the run checks between steps and lines, and whisper.cpp checks through its
  abort callback. Reading the audio and loading the model have no check, so a
  new run waits up to 30 s for a stopped engine to end. An engine crash ends
  the app. The stall watch is off, because it reads the engine's own CPU time.
  On the emulator a cancel during transcription ended the engine within two
  seconds. Restart and the memory guard's stop have not run on a phone.
- **Memory.** iOS reports `os_proc_available_memory`, what the system still
  lets this app allocate. Android reports `MemAvailable` through sysinfo, not
  `ActivityManager.getMemoryInfo` as first planned. Free disk comes from
  `statvfs`. The guards are the desktop's, so a 2 GB emulator is refused a run
  that needs 1.9 GB, and "Try anyway" works as on the desktop. iOS keeps
  512 MB free at the start instead of 1 GB, and stops a run under 200 MB
  instead of 400 MB, because the figure is already this app's own share: an
  iPhone XR with 3 GB lets the app use about 1.8 GB. There Universal Small
  (0.7 GB) runs, and Universal Compact (1.3 GB) crashed and is now refused.
  The setup screen shows that share, and on phones rates speed and model fit
  by what the guard lets a run use, not by the phone's RAM.
- **Recordings.** iOS hands over a temporary copy and Android a `content://`
  URI. `src-tauri/src/recordings.rs` keeps a copy in
  `recordings/<id>/<name>` in the app data, deletes it with its history entry,
  and at start deletes copies no entry uses. iOS moves the app data folder on
  a reinstall, which leaves old absolute paths in the history, so at start the
  app points entries back at their copies by the `<id>` folder.
- **Export** goes through the save dialog, which on a phone points where the
  app cannot write (`src-tauri/src/phone_export.rs`). iOS's dialog copies a
  file of the chosen name out of the app's Documents folder, so the app
  writes the export there first and deletes it once the dialog closes.
  Android's dialog returns a `content://` address, which the fs plugin opens.
- **Touch.** A tap on a word or line plays at once. A long-press or a double
  tap opens the line's editor. Nothing is revealed on hover, because iOS
  spends the first tap on a hover that changes what is shown.
- **Left out on phones** (`FEATURES.mobile` in `src/lib/ipc.ts`): speaker
  detection, updates, the CPU and RAM footer, adding model files and showing
  folders.
- **The iOS Simulator runs on the CPU.** Its Metal driver ends the app when
  whisper.cpp uploads a model (`IOS_SIMULATOR` in `engine/src/transcribe.rs`).
  A real iPhone uses Metal.
- **Downloads on Android** trust Mozilla's root certificates bundled in the
  app (`webpki-root-certs`), because reqwest's platform verifier needs a JNI
  setup there that Tauri does not do.

## Not known yet

- Speed and peak memory on real phones. The simulator and emulator use the
  Mac's chip and say nothing about phones.
- Whether iOS 26's `BGContinuedProcessingTask` keeps a 30-minute
  transcription alive. Until then a locked screen suspends a run.
- Whether ggml's Vulkan backend is worth allowing per Android device, as the
  desktop does with the Vulkan sidecar.
- Whether the Core ML encoder is worth adding on iPhone.
