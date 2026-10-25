---
name: release
description: Use when releasing a new version of the tlansclaib app. Picks the
  next version from the commits, writes the CHANGELOG.md entry and the release
  notes, bumps the version, tags it, has GitHub Actions build the Mac and
  Windows installers, and publishes the draft release. Trigger on "release",
  "new version", "publish a release", "cut 0.4.0", "ship it", "build the
  installers on GitHub", "write the changelog", "release notes". Not for the
  model releases (`models-vN`), see docs/release.md for those.
---

# Release

How the pipeline builds, signs and updates is in `docs/release.md`. This is
the order of work. Ask before step 9 and step 12, because both act in public.

## 1. Check main

```bash
git fetch origin
git status -sb
```

Work on `main` with a clean tree. Main must not be behind `origin/main`. Being
ahead is fine: those commits go out with the release.

## 2. Pick the version

```bash
prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*')
git log --format='%h %s' "$prev"..HEAD
git log --format='%B' "$prev"..HEAD | grep -E '^BREAKING CHANGE:'
```

Read the type of every commit since `$prev`:

- Any `feat`, or a breaking change (`!` before the colon or a
  `BREAKING CHANGE:` footer): minor, `0.3.2` becomes `0.4.0`.
- Only `fix`, `perf` or `revert`: patch, `0.3.2` becomes `0.3.3`.
- Only `chore`, `docs`, `ci`, `test`, `refactor` or `style`: nothing changed
  for users. Stop and ask whether a release is wanted at all.
- Major only when the user names it.

State the result with its reason, such as "4 feat and 2 fix since v0.3.0, so
0.4.0", and let the user override it.

## 3. Write the CHANGELOG.md entry

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
It is the technical record: one bullet per user-facing commit, in the commit's
own terms, ending with its scope and short hash.

```markdown
## [0.4.0] - 2026-11-02

### Added

- Split lines and change their speaker in the transcript (speakers, a5e1e6c)
```

- Date the heading in UTC: `TZ=UTC date +%F`.
- Insert the new entry above the previous one.
- `feat` goes under Added, or under Changed when it alters something users
  already had, or under Removed when it takes something away. `fix` goes
  under Fixed, `perf` under Changed. Leave out `chore`, `docs`, `ci`, `test`,
  `refactor` and `style`.
- Merge a `fix` of something that never shipped into the bullet of the
  feature it belongs to.
- Lead each section with what matters most to users, not in commit order.
- Add the compare link at the bottom, newest first:
  `[0.4.0]: https://github.com/mawiswiss/tlansclaib/compare/v0.3.0...v0.4.0`.

## 4. Write the release notes

The notes are for people using the app, shown on the GitHub release page. Write
them to a temporary file outside the repository. They are never committed.

- Group under `### New`, `### Improved` and `### Fixed`, leaving out empty
  groups.
- One line per change users notice, in plain words, built from the commit
  bodies. No scopes, hashes, file names, library names or instruction-set
  names. Fold several commits about one feature into one line.
- `gh release edit --notes-file` replaces the whole body, so end the file with
  the install text from `releaseBody` in `.github/workflows/release.yml`,
  copied unchanged, then the compare line:

```markdown
**Full Changelog**: https://github.com/mawiswiss/tlansclaib/compare/v0.3.0...v0.4.0
```

Show the version, the CHANGELOG.md entry and the notes, and wait for the user
to confirm or correct them.

## 5. Set the version

Change these three lines, never with a global replace, because tests and the
mock hold version strings that are fixtures:

- `version` in the workspace `Cargo.toml`
- `"version"` in `package.json`
- `"version"` in `src-tauri/tauri.conf.json`

Cargo rewrites the two workspace entries in `Cargo.lock` during step 6.

## 6. Run the checks

```bash
pnpm typecheck && pnpm test && cargo test --workspace
git diff --stat
```

All must pass. The diff covers `CHANGELOG.md` plus 4 files with 5 version
lines: `Cargo.lock` (2), `Cargo.toml`, `package.json` and
`src-tauri/tauri.conf.json`.

## 7. Commit

One signed commit with the CHANGELOG.md entry and the version, in UTC:

```bash
git add CHANGELOG.md Cargo.lock Cargo.toml package.json src-tauri/tauri.conf.json
TZ=UTC git commit -S -m 'chore(release): set version 0.4.0'
```

Check that `git rev-parse HEAD` moved, because a failed signature can leave it
in place.

## 8. Tag

```bash
TZ=UTC git tag -s v0.4.0 -m v0.4.0
git cat-file -t v0.4.0
```

`git cat-file` must print `tag`: an annotated, signed tag.

## 9. Push

Ask first. Then push main and the tag together:

```bash
git push origin main v0.4.0
```

The tag starts `release`, and both pushes start `check`.

## 10. Wait for the build

```bash
gh run list --limit 3 --workflow release
gh run watch <run-id> --exit-status --interval 60
```

Run the watch once, in the background. The jobs `build (macos-latest …)`,
`build (windows-2022 …)` and `updater` must all pass. When `updater` fails
because a platform is missing in `latest.json`, re-run that platform's build
job.

## 11. Check the draft and add the notes

```bash
gh release view v0.4.0 --json isDraft,assets -q '.isDraft, .assets[].name'
gh release download v0.4.0 -p latest.json -O - | jq -r '.version, (.platforms | keys[])'
gh release edit v0.4.0 --notes-file <notes file>
gh release view v0.4.0 --json body -q .body
```

The draft holds these six files: `latest.json`, `tlansclaib-mac.dmg`,
`tlansclaib-mac.app.tar.gz` and its `.sig`, `tlansclaib-windows-setup.exe` and
its `.sig`. `latest.json` names the new version, with `darwin-aarch64`,
`darwin-x86_64` and `windows-x86_64` among the platforms. The body must show
the notes from step 4.

## 12. Publish

Ask first, because every installed copy offers the update from then on and a
release is never pulled back. A bad one is replaced by a higher version.

```bash
gh release edit v0.4.0 --draft=false --latest
curl -sL https://github.com/mawiswiss/tlansclaib/releases/latest/download/latest.json | jq -r .version
```

The second command must print the new version.
