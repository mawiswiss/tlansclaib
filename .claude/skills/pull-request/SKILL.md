---
name: pull-request
description: Use when opening a pull request in the wavetyper repository, or when
  preparing its description. A change users can see gets before and after
  screenshots of the browser version in the description, with a short guide per
  screen and "New" for what did not exist before. Trigger on "open a PR",
  "pull request", "create the PR", "PR description", "screenshots for the PR",
  "before and after". Not for brand pull requests in `pro/`, which the `brand`
  skill opens.
---

# Pull request

Ask before step 4, because a push publishes to GitHub.

## 1. Check the branch

```bash
git fetch origin
git status -sb
git log --oneline origin/main..HEAD
```

Clean tree, branch rebased on `origin/main`. An interface change waits for its
brand pull request in `pro/` to be approved, see `AGENTS.md`.

## 2. Before and after

Only when the diff touches what users see: `src/`, `index.html`, `public-web/`
or the synced brand files. Skip to step 3 otherwise.

The screenshots come from the browser version with invented sample data. Never
from the desktop app on this computer, because it shows real file names, paths
and transcripts. In this public repository the screenshots are public too.

The before is the merge base, not the tip of `main`:

```bash
shots="$PWD/scratch/shots/$(git branch --show-current | tr / -)"
mkdir -p "$shots"
git worktree add --detach "$shots/base" "$(git merge-base HEAD origin/main)"
(cd "$shots/base" && pnpm install --frozen-lockfile)
```

`scratch/` is ignored by git. The browser version needs
`src/lib/web/engine.wasm`, which is built, not committed. When the diff leaves
`engine/` and `web/engine-wasm/` alone, copy it from this checkout, otherwise
run `pnpm wasm` in the worktree.

Start both with the Browser pane's `preview_start`: `web` on port 1432 serves
this checkout. Serve the base on another port from its folder, in the
background: `pnpm exec vite --mode web --port 1433 --strictPort`.

Pick the screens and states the diff changes, from the changed CSS and
components: the drop zone, setup, a transcript, settings, a dialog. Reach each
one by the same steps in both versions. Then for each, in light and dark, at a
1280 px wide window, take a screenshot into `$shots`, named
`<screen>-<theme>-before.png` and `<screen>-<theme>-after.png`. With the Chrome
DevTools tools: `new_page`, `resize_page`, `navigate_page`, `evaluate_script`
with `document.documentElement.dataset.theme = "dark"` (or `"light"`) and
`await document.fonts.ready`, and
`take_screenshot` with `filePath`.

Drop the pairs that did not change:

```bash
cd "$shots" && for a in *-after.png; do b="${a%-after.png}-before.png"; [ -f "$b" ] && cmp -s "$a" "$b" && rm "$a" "$b"; done
```

A pair left over changed, an after alone is **new**, a before alone was
**removed**. Look at every pair yourself and drop one that differs only by
anti-aliasing.

## 3. The description

Title and body follow the commits: what changes for the user and why. Link the
brand pull request when there is one. Then:

```markdown
## Before and after

### Transcript
Speaker names sit in a chip instead of bold text. Look at the left column.

| | Before | After |
|---|---|---|
| Light | [image 1] | [image 2] |
| Dark | [image 3] | [image 4] |

### Search bar
New.

| | Before | After |
|---|---|---|
| Light | New | [image 5] |
| Dark | New | [image 6] |
```

One section per screen, in the order a reviewer should look. The line under
each heading says what changed and where to look. "New" and "Removed" fill the
empty cell, so nobody wonders whether an image failed to load. Write the body
to `$shots/body.md`.

## 4. Push and open

Show the person the commits and the body, and ask. Then:

```bash
git push -u origin HEAD
gh pr create --title "<title>" --body-file "$shots/body.md"
```

## 5. Attach the images

`gh` cannot upload images.

1. Open the pull request in Claude in Chrome, find the file input of the
   comment box at the bottom and give it the PNGs with `file_upload`. Never
   submit the comment.
2. Wait until the box holds one `https://github.com/user-attachments/assets/...`
   link per file, read them, then clear the box.
3. Put each link in place of its `[image n]` in `$shots/body.md` and run
   `gh pr edit <number> --body-file "$shots/body.md"`.

Without Claude in Chrome, leave the placeholders and tell the person which file
belongs to which `[image n]`. They drag each one into the description on GitHub.

## 6. Clean up

Stop the base server, then:

```bash
git worktree remove --force "$shots/base"
```

Delete `$shots` once the description shows the images.
