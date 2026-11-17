# Releases

Installers are built by GitHub Actions, never by hand. The `release` skill in
`.claude/skills/release/` walks through every step.

1. Pick the version from the commits since the last tag. A `feat` or a
   breaking change raises the minor version, fixes alone the patch version.
   A major version is chosen by hand.
2. Add the release to `CHANGELOG.md`, and set the version in
   `src-tauri/tauri.conf.json`, `package.json` and the workspace `Cargo.toml`.
3. Commit, then tag `vX.Y.Z` and push the tag.
4. `.github/workflows/release.yml` builds the Mac disk image, signed with the
   Developer ID and notarised by Apple, the Windows installer and the Linux
   AppImage, and attaches them to a draft GitHub release.
5. Replace the draft's text with the release notes, a plain list of what
   changed for users followed by the install text. Check the draft, then
   publish it as the latest release:
   `gh release edit vX.Y.Z --draft=false --latest`. From then on the app
   offers it as an update.
6. Publishing starts `.github/workflows/lite.yml`, which deploys the browser
   version from the same tag, see Browser version.

The files keep the same names in every version, `wavetyper-mac.dmg`,
`wavetyper-windows-setup.exe` and `wavetyper-linux.AppImage`, so these
addresses always lead to the newest published release:

- https://github.com/mawiswiss/wavetyper/releases/latest/download/wavetyper-mac.dmg
- https://github.com/mawiswiss/wavetyper/releases/latest/download/wavetyper-windows-setup.exe
- https://github.com/mawiswiss/wavetyper/releases/latest/download/wavetyper-linux.AppImage

Releases from before the rename to wavetyper used the former name,
`tlansclaib-mac.dmg` and so on. Once a renamed release is the latest, links to
those names lead nowhere. The live browser version still links to them until
the first wavetyper release is published, which deploys it again.

The repository was called `mawiswiss/tlansclaib`. Every copy installed before
the rename checks for updates and downloads models at that address, and GitHub
forwards it to `mawiswiss/wavetyper`. Never create a repository with the old
name, because the forwarding stops and those copies lose their updates.

The browser version's desktop buttons download from them too. They break
when another release is marked as the latest, which is why the model releases
never are.

`check.yml` runs on every push: Rust and frontend tests, clippy, and the
engine on the English fixture with the tiny model, on macOS, Windows and
Ubuntu 22.04. It
builds the frontend and puts an empty stand-in for the engine sidecar in
place first, because tauri-build refuses to compile the app without either.

## What the build does

- `scripts/sidecar.mjs` builds the engine in release mode for the target and
  copies it to `src-tauri/binaries/`, where Tauri picks it up as a sidecar.
  For `universal-apple-darwin` it builds both Apple slices, keeps each one,
  since tauri-build checks for them while it compiles the app per slice, and
  joins them with `lipo` for the bundle.
- `GGML_NATIVE=OFF` keeps whisper.cpp at an AVX2 baseline on Windows and Linux. Without
  it the build optimises for the CI machine, which may have AVX-512, and the
  binary then crashes on laptops without it. On MSVC that baseline also needs
  FMA, F16C and BMI2, so Haswell from 2013 or newer.
- The engine uses Metal on macOS. Windows and Linux bundle four sidecars: the main CPU
  engine, the Vulkan engine, `wavetyper-engine-avx` for CPUs with AVX but not
  the full AVX2 set (Sandy Bridge, Ivy Bridge), and `wavetyper-engine-sse`,
  plain SSE2, for CPUs without AVX (Celeron, Pentium Silver, Core 2, Athlon
  II). No ggml kernel needs SSE4, so the SSE engine leaves it out. The two older builds set
  every instruction flag explicitly, each in its own target folder, because
  whisper-rs-sys does not rebuild when only an environment variable changes.
  Below AVX, ggml's dot products for quantized models fall back to scalar
  code, so the SSE engine avoids a crash rather than being fast. The Vulkan build
  needs the Vulkan SDK on the build machine, which CI installs. The app
  probes the GPU before a run and falls back to the CPU engine for the
  processor (`cpu.rs`) when Vulkan is unavailable or has too little free
  memory. A processor without the AVX2 set never starts the Vulkan engine,
  because its CPU code needs AVX2 too.
- On Windows the script also copies the Microsoft C++ runtime from the build
  machine's Visual Studio into `src-tauri/binaries/msvc`: `vcruntime140.dll`,
  `vcruntime140_1.dll`, `msvcp140.dll` and the OpenMP `vcomp140.dll`.
  `tauri.windows.conf.json` installs them beside the engines. parakeet.cpp's
  library needs all four, and a PC without the Visual C++ Redistributable has
  none of them, so the better speaker detection could not start there.
  sherpa-onnx's archive is the static `-MT` build and needs none. The engine
  loads a detection library with its own folder and then the engine's folder
  on the search path.
- Linux ships one AppImage, the only Linux format Tauri's updater can
  replace. It is built on Ubuntu 22.04, so it needs glibc 2.35 or newer.
  It carries WebKitGTK and GStreamer's base and good plugins for the audio
  player. Which formats play has not been tested. The release job unpacks
  it and checks with `ldd` in a bare Ubuntu 22.04 container that the engines
  find every library except the Vulkan loader, which the graphics driver
  brings. parakeet.cpp's library, downloaded later, needs `libgomp.so.1`
  from the system, or the better speaker detection reports itself broken.
- tauri-action names the files after `assetNamePattern`. Next to the three
  installers, the release holds the update files, see Updates.

## Browser version

wavetyper Lite runs the latest published release, so it shows the same
version as the desktop app and its download buttons lead to the installers of
that version. `lite.yml` runs when a release is published and deploys the
latest published release, not the commit that started it. A prerelease, or an
older version published later, changes nothing. It runs the frontend tests,
builds `dist-web/` from the release tag, deploys it with Wrangler to the
Cloudflare Pages project `wavetyper-lite` and checks that
https://wavetyper.marcwieland.name answers cross-origin isolated.

- It needs two secrets in the `lite` environment: `CLOUDFLARE_API_TOKEN`, an
  API token with the account permission Cloudflare Pages: Edit, and
  `CLOUDFLARE_ACCOUNT_ID`. Without them the job fails instead of skipping, so
  Lite never falls behind unnoticed.
- GitHub starts it only for a release published by a person, as the `release`
  skill does with `gh`. A release published by another workflow with
  `GITHUB_TOKEN` starts nothing.
- A change on `main` reaches Lite with the next release, never on its own.
- To deploy again, for example after a failed run, start `lite` by hand under
  Actions, or with `gh workflow run lite`. It deploys the latest published
  release again.

## The Pro module

Without the secret `PRO_DEPLOY_KEY`, the release builds the free app. With it,
the installers include the private Pro module, locked until a licence key
unlocks it (`docs/editions.md`).

- With the key, the release job checks out `mawiswiss/wavetyper-pro` into
  `pro/` at the same tag and builds with `--features pro`. The `release` skill
  tags both repositories, Pro at its `stable` branch, so only what was
  promoted there ships.
- The log is public. Cargo prints short messages, which name file and line
  without the code. The Rust cache is not saved on tags, and every action in
  the job is pinned to a commit. Vite prints a code frame on a syntax error,
  so check Pro locally before tagging.
- To set up the key once, run `ssh-keygen -t ed25519 -N "" -f pro-deploy`.
  Then add `pro-deploy.pub` as a read-only deploy key on the Pro repository,
  add the private key as the secret `PRO_DEPLOY_KEY` here, and delete both
  files.

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
published release, never from a draft or a pre-release. It asks at every
start, once a day while the app stays open, and when someone presses "Check
for updates" in About. The switch "Check for updates on start" there turns
the automatic checks off.

With the updater key in the repository's secrets, the release workflow passes
`src-tauri/tauri.updater.conf.json` to the build, which signs one update per
platform, and tauri-action lists them in `latest.json`:

- macOS: `wavetyper-mac.app.tar.gz`, the notarised universal app.
- Windows: `wavetyper-windows-setup.exe`, the installer, which the app runs
  in passive mode.
- Linux: `wavetyper-linux.AppImage`, which replaces the running AppImage.

Each has a `.sig` next to it. The app checks it against the public key in
`src-tauri/tauri.conf.json` and refuses an update without a valid one, or
one signed for another version than `latest.json` announces. The three
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
gh release create models-v1 --repo mawiswiss/wavetyper --latest=false --title "Speech models" --notes-file docs/model-release.md ggml-thai-fast-q8_0.bin ggml-thai-best-q8_0.bin ggml-swiss-german-q8_0.bin
```

Each file must stay under 2 GiB, the limit for a release file. A new model
joins the release, and the notes follow it:

```bash
gh release upload models-v1 --repo mawiswiss/wavetyper ggml-<name>-q8_0.bin
gh release edit models-v1 --repo mawiswiss/wavetyper --notes-file docs/model-release.md
```

A changed model gets a new tag, such as `models-v2`, and new addresses in the
list, because the app checks every download against the size and SHA-256 in
the list.

## Local build

`pnpm tauri build` needs Rust, CMake, Node 22 and pnpm. The app and the disk
image land under `target/release/bundle/`, signed ad hoc, without an update.

## Brand files

The tokens, fonts, logos and icons come from the private brand folder,
`pro/brand`, as it stands on the pro `stable` branch.
`scripts/brand-sync.mjs` copies them in and commits nothing:
`src/styles/tokens.css`, `src/assets/fonts/`, `src/assets/brand/`, the desktop
icons in `src-tauri/icons/` and the browser version's favicons and
apple-touch-icon in `public-web/`. Never edit those files by hand. Run it after
the brand changes, on a Mac, because it builds `icon.icns` with `iconutil`:

```bash
node scripts/brand-sync.mjs
```

To try a brand change before it reaches `stable`, add `--ref main` or
another ref, and commit nothing it writes.

The desktop icons come from `app-icon.svg`, except the 16 and 32 px images
inside `icon.ico` and `icon.icns` and `32x32.png`, which come from
`mark-small.svg`, as the brand guide asks.

The browser version's share image, `public-web/og-image.png`, is rendered from
`scripts/og-image.html` with sample data. With `pnpm dev` running:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=4000 --screenshot=public-web/og-image.png http://localhost:1420/scripts/og-image.html
```
