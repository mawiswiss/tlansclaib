# Releases

Installers are built by GitHub Actions, never by hand.

1. Set the version in `src-tauri/tauri.conf.json`, `package.json` and the
   workspace `Cargo.toml`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. `.github/workflows/release.yml` builds a universal macOS `.dmg` and Windows
   `.msi` and `.exe` installers and attaches them to a draft GitHub release.
4. Check the draft, then publish it.

`check.yml` runs on every push: Rust and frontend tests, clippy, and the engine
on the English fixture with the tiny model, on macOS and Windows runners.

## What the build does

- `scripts/sidecar.mjs` builds the engine in release mode for the target and
  copies it to `src-tauri/binaries/`, where Tauri picks it up as a sidecar.
  For `universal-apple-darwin` it builds both Apple slices and joins them with
  `lipo`.
- `GGML_NATIVE=OFF` keeps whisper.cpp at an AVX2 baseline on Windows. Without
  it the build optimises for the CI machine, which may have AVX-512, and the
  binary then crashes on laptops without it. On macOS Metal does the heavy
  work, so the flag changes little.
- The engine uses Metal on macOS and the CPU on Windows.

## Local build

```bash
pnpm tauri build
```

needs Rust, CMake, Node 22 and pnpm. The installer lands under
`target/release/bundle/`.

## Signing

The builds are unsigned. macOS asks for a right-click, Open on the first start,
Windows shows the SmartScreen dialog once. Signing and notarisation are a later
step if the warnings become a problem.
