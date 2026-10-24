# Releases

Installers are built by GitHub Actions, never by hand.

1. Set the version in `src-tauri/tauri.conf.json`, `package.json` and the
   workspace `Cargo.toml`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. `.github/workflows/release.yml` builds the Mac disk image, signed with the
   Developer ID and notarised by Apple, and the Windows installer, and
   attaches both to a draft GitHub release.
4. Check the draft, then publish it as the latest release:
   `gh release edit vX.Y.Z --draft=false --latest`. From then on the app
   offers it as an update.

The files keep the same names in every version, `tlansclaib-mac.dmg` and
`tlansclaib-windows-setup.exe`, so these addresses always lead to the newest
published release:

- https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-mac.dmg
- https://github.com/mawiswiss/tlansclaib/releases/latest/download/tlansclaib-windows-setup.exe

They break when another release is marked as the latest, which is why the
model releases never are.

`check.yml` runs on every push: Rust and frontend tests, clippy, and the
engine on the English fixture with the tiny model, on macOS and Windows. It
builds the frontend and puts an empty stand-in for the engine sidecar in
place first, because tauri-build refuses to compile the app without either.

## What the build does

- `scripts/sidecar.mjs` builds the engine in release mode for the target and
  copies it to `src-tauri/binaries/`, where Tauri picks it up as a sidecar.
  For `universal-apple-darwin` it builds both Apple slices, keeps each one,
  since tauri-build checks for them while it compiles the app per slice, and
  joins them with `lipo` for the bundle.
- `GGML_NATIVE=OFF` keeps whisper.cpp at an AVX2 baseline on Windows. Without
  it the build optimises for the CI machine, which may have AVX-512, and the
  binary then crashes on laptops without it.
- The engine uses Metal on macOS. Windows bundles CPU and Vulkan sidecars. The
  Vulkan build needs the Vulkan SDK on the build machine, which CI installs.
  The app probes the GPU before a run and falls back to the CPU sidecar when
  Vulkan is unavailable or has too little free memory.
- tauri-action names the files after `assetNamePattern`. Next to the two
  installers, the release holds the update files, see Updates.

## Signing

The release workflow signs the Mac app with a Developer ID and has Apple
notarise it and the disk image. The credentials live in the repository's
secrets. Without them, as in a fork, the app is signed ad hoc
(`"signingIdentity": "-"`), and macOS blocks the first start until "Open
Anyway" under Privacy & Security.

Speaker detection loads the libraries of sherpa-onnx and parakeet.cpp,
downloaded after the install, so `src-tauri/entitlements.plist` allows libraries signed by someone
else. The hardened runtime that notarisation requires refuses them otherwise.

The Windows installer is not signed. SmartScreen asks once.

## Updates

The app updates itself with Tauri's updater plugin, from GitHub. It asks
`releases/latest/download/latest.json`, which GitHub serves from the newest
published release, never from a draft or a pre-release. It asks once a day
on start, and when someone presses "Check for updates" in About. The switch
"Check for updates on start" there turns the daily check off.

With the updater key in the repository's secrets, the release workflow passes
`src-tauri/tauri.updater.conf.json` to the build, which signs one update per
platform, and tauri-action lists them in `latest.json`:

- macOS: `tlansclaib-mac.app.tar.gz`, the notarised universal app.
- Windows: `tlansclaib-windows-setup.exe`, the installer, which the app runs
  in passive mode.

Each has a `.sig` next to it. The app checks it against the public key in
`src-tauri/tauri.conf.json` and refuses an update without a valid one, or
one signed for another version than `latest.json` announces. The two
build jobs write `latest.json` in turn, so the `updater` job fails when a
platform is missing. Re-run that platform's build job before publishing.

Without the key, as in a fork, nothing is signed and there is no
`latest.json`. The macOS `.tar.gz` is then the plain app.

Versions only move forward. A bad release is replaced by a higher version,
not pulled back. If the key is lost, installed copies cannot update any more
and need one manual install of a version with a new public key.

## Model files

The converted models download from the release `models-v1`, which the
model list in `src-tauri/resources/models.json` points to. Its tag does not
start with `v`, so the release workflow leaves it alone. It holds the files
from the conversion and the release notes that carry the attribution, and it
is never the latest release:

```bash
gh release create models-v1 --repo mawiswiss/tlansclaib --latest=false --title "Speech models" --notes-file docs/model-release.md ggml-thai-fast-q8_0.bin ggml-thai-best-q8_0.bin ggml-swiss-german-q8_0.bin ggml-french-large-v3-q8_0.bin
```

Each file must stay under 2 GiB, the limit for a release file. A new model
joins the release, and the notes follow it:

```bash
gh release upload models-v1 --repo mawiswiss/tlansclaib ggml-french-large-v3-q8_0.bin
gh release edit models-v1 --repo mawiswiss/tlansclaib --notes-file docs/model-release.md
```

A changed model gets a new tag, such as `models-v2`, and new addresses in the
list, because the app checks every download against the size and SHA-256 in
the list.

## Local build

`pnpm tauri build` needs Rust, CMake, Node 22 and pnpm. The app and the disk
image land under `target/release/bundle/`, signed ad hoc, without an update.

## Icon

`src-tauri/icons/icon.svg` is the source. After changing it, regenerate the
platform files into a scratch folder and copy over the ones in
`src-tauri/icons/`. The Android and iOS sets the tool also writes are not used.

```bash
pnpm tauri icon src-tauri/icons/icon.svg -o /tmp/tlansclaib-icons
```
