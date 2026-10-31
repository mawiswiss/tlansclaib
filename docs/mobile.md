# Mobile app

A native tlansclaib for iPhone and Android is feasible and belongs to Free.
The engine runs inside the app, whisper.cpp on the phone's own chip, and the
models download as on the desktop. Nothing is built yet. This file is the plan
and what is still unknown.

The browser version is no route to phones: its model peaked at 4.2 GB, which
a mobile tab does not get (`docs/browser.md`). The native engine needs about
1.3 GB for a turbo q8_0 model.

## What carries over

- **The engine crate.** whisper-rs, symphonia and rubato have no system
  dependencies and build for `aarch64-apple-ios` and `aarch64-linux-android`.
  whisper.cpp uses Metal on iPhone and the CPU on Android, Vulkan where a
  driver holds up.
- **The guards.** The checks in `src-tauri/src/guard.rs` take free memory and
  free disk as arguments, so they stay as they are. Only the numbers fed in
  change.
- **The frontend.** Tauri 2 builds iOS and Android from the same React app.

## What changes

1. **The engine runs in the app, not as a sidecar.** iOS does not let an app
   start another process, and Tauri's shell plugin has no sidecars on mobile.
   The run loop lives in `engine/src/main.rs` (`run`), so it moves into the
   library and sends the same `protocol.rs` events through a callback instead
   of stdout. The desktop keeps the sidecar, which a crash cannot take down
   with it. On mobile an engine crash ends the app.
2. **Stopping a run.** The desktop kills the sidecar when memory gets tight.
   In-process, the run has to stop itself: whisper.cpp's abort callback,
   checked against `should_stop` between lines.
3. **Memory numbers per platform.** `os_proc_available_memory` on iOS, which
   is what the system lets this app use, not what the phone has free.
   `ActivityManager.getMemoryInfo` on Android. The model list hides models
   the phone cannot run, as on the desktop.
4. **Speaker detection is bundled.** `engine/src/speakers/mod.rs` loads
   sherpa-onnx and parakeet.cpp with `libloading` from a downloaded folder.
   The App Store forbids running downloaded code, so on iOS both are linked
   into the app. Model files stay downloads. Android may keep loading them,
   but bundling is simpler to ship the same way.
5. **Long runs off screen.** iOS suspends an app shortly after it leaves the
   screen. iOS 26's `BGContinuedProcessingTask` is meant for long work the user
   started, with progress shown by the system. GPU use there needs its own
   entitlement. Android needs a foreground service with a notification.
6. **Opening a recording.** Files come from the share sheet, the Files app or
   the Android document picker, not drag and drop.

## Traps

- **iOS ends an app over its memory limit without warning.** The limit is
  below the phone's memory and differs per iPhone model. The entitlement
  `com.apple.developer.kernel.increased-memory-limit` raises it. Thai Best,
  at 2.4 GB peak, is likely too much for many iPhones.
- **Android GPUs vary.** ggml's Vulkan backend is fast on some Adreno and
  Mali chips and wrong or slow on others. Plan for the CPU and allow the GPU
  per device, as the desktop does with the Vulkan sidecar.
- **Heat.** A phone throttles after a few minutes of full load, so the time
  estimate has to learn from the run, not from the first minute.
- **Downloads of 0.3 to 1.6 GB** on mobile data. Ask before downloading
  outside Wi-Fi.

## Not known yet

- Speed and memory on a real iPhone and a real mid-range Android phone. The
  iOS Simulator runs on the Mac's GPU and memory and shows neither.
- Whether `BGContinuedProcessingTask` keeps a 30-minute transcription alive.
- Whether the Core ML encoder is worth adding on iPhone.

## First step

A spike before any app work: build the engine for `aarch64-apple-ios` and
`aarch64-linux-android`, transcribe a synthetic fixture with Universal Small
and Universal Compact on one real phone of each kind, and record the time
and the peak memory here.
