export type Theme = "system" | "light" | "dark";

export type Settings = {
  modelId: string;
  language: string;
  timestamps: boolean;
  speakers: string;
  theme: Theme;
  transcribed: number | null;
  supportAskedAt: number | null;
  supported: boolean;
  checkUpdates: boolean;
  updateCheckedAt: number | null;
};

const STORAGE = "tlansclaib.settings";
export let settingsLoadError: string | null = null;

export const DEFAULTS: Settings = {
  modelId: "",
  language: "auto",
  timestamps: true,
  speakers: "off",
  theme: "system",
  transcribed: null,
  supportAskedAt: null,
  supported: false,
  checkUpdates: true,
  updateCheckedAt: null,
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    delete saved.outputDir;
    delete saved.speakerPrecision;
    return { ...DEFAULTS, ...saved };
  } catch (error) {
    settingsLoadError = `Could not load saved settings. Defaults are being used: ${String(error)}`;
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE, JSON.stringify(settings));
}
