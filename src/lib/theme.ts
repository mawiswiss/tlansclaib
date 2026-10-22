import { isTauri } from "./ipc";
import type { Theme } from "./settings";

export function applyTheme(theme: Theme): Promise<void> {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (isTauri) {
    return import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === "system" ? null : theme));
  }
  return Promise.resolve();
}
