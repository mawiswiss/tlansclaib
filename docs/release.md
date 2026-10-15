# Releases

Installers are built by GitHub Actions, never by hand.

1. Set the version in `src-tauri/tauri.conf.json`, `package.json` and the
   workspace `Cargo.toml`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. `.github/workflows/release.yml` builds the Mac disk image, signed with the
   Developer ID and notarised by Apple, and the Windows installer, and
   attaches both to a draft GitHub release.
4. Check the draft, then publish it as the latest release:
   `gh release edit vX.Y.Z --draft=false --latest`.

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
- The engine uses Metal on macOS and the CPU on Windows.
- tauri-action names the files after `assetNamePattern`. On macOS it also
  uploads the app as a `.tar.gz`, which the workflow deletes again, so the
  release holds the two installers only.

## Signing

The Mac app and its engine are signed with the Developer ID from the
repository's secrets, with the hardened runtime that notarisation requires.
Speaker detection loads sherpa-onnx's libraries, downloaded after the install
and signed by someone else, so `src-tauri/entitlements.plist` gives the app
and the engine `com.apple.security.cs.disable-library-validation`. Without it
the engine fails to load them.

Tauri notarises the app and signs the disk image around it. The workflow then
notarises and staples the disk image as well, and has Gatekeeper assess both.
A rejection fails the build.

Without the secrets, as in a fork, the workflow skips all of this and the app
is signed ad hoc, `"signingIdentity": "-"` in `tauri.conf.json`. macOS then
blocks the first start until "Open Anyway" under Privacy & Security. The
variable `APPLE_SIGNING_IDENTITY` overrides the `"-"`.

The Windows installer is not signed. SmartScreen asks once.

## Model files

The three converted models download from the release `models-v1`, which the
model list in `src-tauri/resources/models.json` points to. Its tag does not
start with `v`, so the release workflow leaves it alone. It holds the files
from the conversion and the release notes that carry the attribution, and it
is never the latest release:

```bash
gh release create models-v1 --repo mawiswiss/tlansclaib --latest=false --title "Speech models" --notes-file docs/model-release.md ggml-thai-fast-q8_0.bin ggml-thai-best-q8_0.bin ggml-swiss-german-q8_0.bin
```

Each file must stay under 2 GiB, the limit for a release file. A new or
changed model gets a new tag, such as `models-v2`, and new addresses in the
list, because the app checks every download against the size and SHA-256 in
the list.

## Local build

`pnpm tauri build` needs Rust, CMake, Node 22 and pnpm. The app and the disk
image land under `target/release/bundle/`, signed ad hoc.

## Icon

`src-tauri/icons/icon.svg` is the source. After changing it, regenerate the
platform files into a scratch folder and copy over the ones in
`src-tauri/icons/`. The Android and iOS sets the tool also writes are not used.

```bash
pnpm tauri icon src-tauri/icons/icon.svg -o /tmp/tlansclaib-icons
```
