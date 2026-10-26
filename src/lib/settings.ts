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
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    delete saved.outputDir;
    if (saved.modelId === "") delete saved.modelId;
    return { ...DEFAULTS, ...saved };
  } catch (error) {
    settingsLoadError = `Could not load saved settings. Defaults are being used: ${String(error)}`;
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE, JSON.stringify(settings));
}
