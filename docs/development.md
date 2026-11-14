# Development

## Testing errors and toasts

Errors and toasts only show when something fails. To look at them on demand,
open the "Test errors" panel in any development build (`pnpm dev`,
`pnpm dev:web`, `pnpm tauri dev`, `pnpm tauri ios dev`):

- Cmd+Shift+E on a Mac, Ctrl+Shift+E elsewhere.
- The "Test errors" button in the footer of the About dialog, for phones.

The panel fires toasts through the app's own `notify`, so the fade times, the
limit on visible toasts and the action buttons behave as in a real failure. It
also shows the "did not finish" and "Cancelled" screens and the inline errors in
the models dialog, setup, speed measurement, history and an open result. Its
buttons never touch models, files or runs. Release builds do not contain the
panel.

## Mock backend flags

`pnpm dev` without Tauri runs on a stand-in backend, `src/lib/mock.ts`. Query
parameters on the URL, such as `http://localhost:1420/?lowram=3&speakers`,
simulate states the test panel cannot reach safely, because their buttons start
runs or downloads:

| Flag | Effect |
| --- | --- |
| `fresh` | No model installed, so the app starts at setup. |
| `heavy` | Thai Compact is already marked too heavy. |
| `midstop` | A run stops halfway for memory and shows the too-heavy card. |
| `lowram=N` | N GB free (default 2), so a start asks about memory. |
| `totalram=N` | The computer has N GB of RAM (default 16). |
| `stress` | Only 10.8 GB of disk are free. |
| `speakers` | Speaker detection (sherpa) is installed. |
| `nemotron` | The Nemotron speaker detection is installed. |
| `speakerfail` | Speaker detection fails during a run. Needs `speakers` or `nemotron` and speaker names on. |
| `broken` | Nemotron is installed, does not start, and differs from the download. |
| `intact` | Nemotron is installed and does not start, but the files are intact. |
| `nogpu` | No usable graphics chip. |
| `slowpc` | History entries carry timings from a slow processor. |
| `slowstep` | Each run takes 15 seconds longer. |
| `offline` | The download speed check cannot reach the model server. |
| `slow` | The download speed check measures 1.2 MB/s. |
| `update=fail` | The update check fails. Any other value offers version 0.2.0. |
| `update=blocked` | An update is offered but blocked. |
