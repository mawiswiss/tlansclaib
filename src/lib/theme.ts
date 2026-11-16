import { isTauri } from "./ipc";
import type { Theme } from "./settings";

let freezes = 0;

function freezeTransitions(until: Promise<unknown>) {
  const root = document.documentElement;
  const token = ++freezes;
  root.classList.add("theme-switching");
  void until.finally(() =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token === freezes) root.classList.remove("theme-switching");
      }),
    ),
  );
}

export function watchSystemTheme() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => freezeTransitions(Promise.resolve()));
}

export function applyTheme(theme: Theme): Promise<void> {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const done = isTauri
    ? import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === "system" ? null : theme))
    : Promise.resolve();
  freezeTransitions(done);
  return done;
}
