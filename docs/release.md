# Releases

Installers are built by GitHub Actions, never by hand.

1. Set the version in `src-tauri/tauri.conf.json`, `package.json` and the
   workspace `Cargo.toml`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. `.github/workflows/release.yml` builds a universal macOS `.dmg` and Windows
   `.msi` and `.exe` installers and attaches them to a draft GitHub release.
4. Check the draft, then publish it.

`check.yml` runs on every push: Rust and frontend tests, clippy, and the engine
on the English fixture with the tiny model, on macOS and Windows runners. It
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
  binary then crashes on laptops without it. On macOS Metal does the heavy
  work, so the flag changes little.
- The engine uses Metal on macOS and the CPU on Windows.

## Model files

The three converted models download from the release `models-v1`, which the
model list in `src-tauri/resources/models.json` points to. Its tag does not
start with `v`, so the release workflow leaves it alone. Create it once, with
the files from the conversion and the release notes that carry the
attribution:

```bash
gh release create models-v1 --repo mawiswiss/tlansclaib --title "Speech models" --notes-file docs/model-release.md ggml-thai-fast-q8_0.bin ggml-thai-best-q8_0.bin ggml-swiss-german-q8_0.bin
```

Each file must stay under 2 GiB, the limit for a release file. A new or
changed model gets a new tag, such as `models-v2`, and new addresses in the
list, because the app checks every download against the size and SHA-256 in
the list.

## Local build

```bash
pnpm tauri build
```

needs Rust, CMake, Node 22 and pnpm. The installer lands under
`target/release/bundle/`.

## Icon

`src-tauri/icons/icon.svg` is the source. After changing it, regenerate the
platform files into a scratch folder and copy over the ones in
`src-tauri/icons/`. The Android and iOS sets the tool also writes are not used.

```bash
pnpm tauri icon src-tauri/icons/icon.svg -o /tmp/tlansclaib-icons
```

## Signing

The Mac build is signed ad hoc, `"signingIdentity": "-"` in `tauri.conf.json`,
without an Apple developer certificate. Without it the bundle carries only the
linker's signature and fails `codesign --verify --deep --strict`. With it,
macOS blocks only the first start, which "Open Anyway" under Privacy &
Security in System Settings lets through. Windows shows the SmartScreen dialog
once. A certificate and notarisation are a later step if the warnings become a
problem.

Speaker detection loads sherpa-onnx's libraries, downloaded after the install,
into the engine. That works because `"hardenedRuntime": false` keeps the
hardened runtime off. With it on, which is Tauri's default, the engine fails to
load them. Notarisation requires the hardened runtime, so the engine sidecar
then needs the entitlement `com.apple.security.cs.disable-library-validation`.
