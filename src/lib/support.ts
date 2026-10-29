import type { Settings } from "./settings";
import type { HistoryEntry } from "./types";

export const SUPPORT_FIRST = import.meta.env.MODE === "web" ? 3 : 10;
export const SUPPORT_EVERY = 25;

export function shouldAskForSupport(settings: Settings): boolean {
  if (settings.supported) return false;
  const due = settings.supportAskedAt === null ? SUPPORT_FIRST : settings.supportAskedAt + SUPPORT_EVERY;
  return (settings.transcribed ?? 0) >= due;
}

export function askedForSupport(settings: Settings): Settings {
  return { ...settings, supportAskedAt: settings.transcribed ?? 0 };
}

export function countFromHistory(settings: Settings, history: HistoryEntry[]): Settings {
  if (settings.transcribed !== null) return settings;
  return { ...settings, transcribed: history.filter((e) => e.status === "done").length };
}

export function countOne(settings: Settings): Settings {
  return { ...settings, transcribed: (settings.transcribed ?? 0) + 1 };
}
