export type Theme = "system" | "light" | "dark";

export type Settings = {
  modelId: string;
  language: string;
  timestamps: boolean;
  outputDir: string | null;
  speakers: string;
  speakerPrecision: "standard" | "fast";
  theme: Theme;
  transcribed: number | null;
  supportAskedAt: number | null;
  supported: boolean;
};

const STORAGE = "tlansclaib.settings";
export let settingsLoadError: string | null = null;

export const DEFAULTS: Settings = {
  modelId: "",
  language: "auto",
  timestamps: true,
  outputDir: null,
  speakers: "off",
  speakerPrecision: "standard",
  theme: "system",
  transcribed: null,
  supportAskedAt: null,
  supported: false,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE) ?? "{}") };
  } catch (error) {
    settingsLoadError = `Could not load saved settings. Defaults are being used: ${String(error)}`;
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE, JSON.stringify(settings));
}
