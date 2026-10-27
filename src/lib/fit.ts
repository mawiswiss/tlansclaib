import type { Stats } from "./types";

export type Level = "ok" | "warn" | "high";

export type Rating = { level: Level; tip: string | null };

const GIB = 2 ** 30;

export function level(fraction: number): Level {
  if (fraction >= 0.9) return "high";
  if (fraction >= 0.7) return "warn";
  return "ok";
}

export function memoryLevel(stats: Stats): Level {
  const l = level(stats.memory_used / stats.memory_total);
  return stats.memory_free < 1.5 * GIB ? "high" : l;
}

export const FIT_LABEL: Record<Level, string> = { ok: "Fits", warn: "Tight", high: "Could overload" };

export function ramFit(ramGb: number, totalMemory: number): Rating {
  const share = (ramGb * GIB) / totalMemory;
  if (share >= 1) return { level: "high", tip: "Needs more RAM than this computer has." };
  if (share >= 0.9) return { level: "high", tip: "Leaves almost no RAM for anything else. It could overload the computer." };
  if (share >= 0.7) return { level: "warn", tip: "Takes most of the RAM. Close other programs before a long transcription." };
  return { level: "ok", tip: null };
}

export function failedFit(reason: string): Rating {
  return { level: "high", tip: `${reason} Automatic prefers other models until a transcription with it finishes.` };
}

export function diskFit(size: number, free: number, minimum: number, reserve: number): Rating {
  if (free < size + minimum) return { level: "high", tip: "Not enough free disk space. Make room first." };
  if (free < size + reserve) return { level: "warn", tip: "Leaves less than 10 GB free on the disk." };
  return { level: "ok", tip: null };
}

export function downloadFit(seconds: number): Rating {
  if (seconds >= 3600) return { level: "high", tip: "Slow on this connection. Keep the app open until it is done." };
  if (seconds >= 600) return { level: "warn", tip: "Takes a while on this connection." };
  return { level: "ok", tip: null };
}

export function downloadSeconds(size: number, bytesPerSecond: number): number {
  return bytesPerSecond > 0 ? size / bytesPerSecond : Infinity;
}
