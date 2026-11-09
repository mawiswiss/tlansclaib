import { isTauri } from "./ipc";
import type { Setup } from "./setup";

export type Theme = "system" | "light" | "dark";

export type Settings = {
  modelId: string;
  language: string;
  timestamps: boolean;
  speakers: string;
  speakerPrecision: "standard" | "fast";
  theme: Theme;
  transcribed: number | null;
  supportAskedAt: number | null;
  supported: boolean;
  checkUpdates: boolean;
  setup: Setup | null;
  showDetails: boolean;
  /** Notes below the settings row the user closed, such as `better:<model id>`. */
  dismissed: string[];
};

const STORAGE = "tlansclaib.settings";
export let settingsLoadError: string | null = null;

export const DEFAULTS: Settings = {
  modelId: "auto",
  language: "auto",
  timestamps: true,
  speakers: "off",
  speakerPrecision: "standard",
  theme: "system",
  transcribed: null,
  supportAskedAt: null,
  supported: false,
  checkUpdates: true,
  setup: null,
  showDetails: false,
  dismissed: [],
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    delete saved.outputDir;
    if (saved.modelId === "") delete saved.modelId;
    return { ...DEFAULTS, ...saved };
  } catch (error) {
    settingsLoadError = `Using the default settings, because the saved ones could not be read: ${String(error)}`;
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE, JSON.stringify(settings));
  if (isTauri) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("mirror_settings", { settings }))
      .catch((error) => warn(`could not mirror the settings to the app data folder: ${String(error)}`));
  }
}

export function settingsMissing(): boolean {
  return isTauri && localStorage.getItem(STORAGE) === null;
}

/** Fills empty storage from the app data folder, which survives a new bundle identifier when the webview's storage does not. */
export async function restoreSettings() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const saved = await invoke<unknown>("mirrored_settings");
    if (saved && typeof saved === "object" && !Array.isArray(saved) && localStorage.getItem(STORAGE) === null) {
      localStorage.setItem(STORAGE, JSON.stringify(saved));
    }
  } catch (error) {
    warn(`could not restore the settings from the app data folder: ${String(error)}`);
  }
}

function warn(message: string) {
  import("@tauri-apps/plugin-log").then((log) => log.warn(message)).catch(() => {});
}
