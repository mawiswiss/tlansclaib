# Working in this repository

tlansclaib is a desktop app for Mac and Windows that transcribes an audio file
on the user's own computer with whisper.cpp. Read `docs/design.md` before
changing anything structural. `docs/` is flat: one kebab-case Markdown file per
topic, no date prefixes, no generated trees.

## Layout

- `engine/`: Rust crate. Library plus the `tlansclaib-engine` binary, which the
  app runs as a sidecar and which also works from a terminal.
- `src-tauri/`: the Tauri 2 app in Rust. Model list and downloads, run
  supervision, memory guard, system statistics.
- `src/`: the React and TypeScript frontend, built with Vite.
- `scripts/`: tooling that is not shipped, such as the model conversion script.

## Commands

- `pnpm install`, then `pnpm tauri dev` for the app with live reload.
- `cargo test --workspace`, `cargo clippy --workspace --all-targets`.
- `pnpm typecheck`, `pnpm test`.
- `pnpm tauri build` for installers. Release builds come from GitHub Actions on
  a `v*` tag, see `docs/release.md`. Release with the `release` skill in
  `.claude/skills/release/`.

## Rules

- The end user installs nothing besides the app: no Python, no ffmpeg, no
  runtime. Everything the app needs is compiled in or downloaded by the app.
- The app must never take the computer down. Every memory and disk check lives
  in `src-tauri/src/guard.rs` as a pure function with a test. Add a check
  before adding a feature that uses more memory.
- No model file is accepted without validation, see `validate.rs` and
  `docs/models.md`.
- Pro features are not built in this repository. `docs/editions.md` draws the
  line between Free and Pro. Ask before building anything on the Pro side,
  listed or not.
- Nothing personal in the repository, in logs or in fixtures: no home paths, no
  device identifiers, no real recordings or transcripts.
- Commit with `TZ=UTC` in the environment, so commit and tag dates carry no
  time zone.
- Prose in English, without em-dashes. Code comments are rare and explain only
  what the code cannot show.
