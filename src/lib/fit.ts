import type { Gpu, Stats } from "./types";

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

/** A phone's memory check: what the guard lets a run use, from what the system gives this app. */
export function budgetFit(ramGb: number, budget: number): Rating {
  if (ramGb * GIB > budget) return { level: "high", tip: "Needs more memory than the phone gives the app." };
  return { level: "ok", tip: null };
}

export function modelFit(ramGb: number, stats: Stats, phone: boolean): Rating {
  return phone ? budgetFit(ramGb, stats.model_budget) : ramFit(ramGb, stats.memory_total);
}

export function failedFit(reason: string): Rating {
  return { level: "high", tip: `${reason} Automatic prefers other models until a transcription with it finishes.` };
}

export type Score = { percent: number; level: Level; word: string; bars: number; speed: number | null; basis: string };

export const VERY_FAST = 80;

function tier(percent: number): { word: string; bars: number } {
  if (percent >= VERY_FAST) return { word: "Very fast", bars: 5 };
  if (percent >= 65) return { word: "Fast", bars: 4 };
  if (percent >= 50) return { word: "Fast", bars: 3 };
  if (percent >= 20) return { word: "Steady", bars: 2 };
  return { word: "Slow", bars: 1 };
}

function chip(gpu: Gpu): { points: number; name: string } {
  if (gpu.usable && gpu.backend === "metal") return { points: 60, name: "Metal" };
  if (gpu.usable && gpu.backend === "vulkan") return { points: 55, name: "Vulkan" };
  if (gpu.backend === "vulkan") return { points: 35, name: "a small Vulkan graphics chip" };
  return { points: 15, name: "the processor alone" };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function estimate(gpu: Gpu, memoryTotal: number, phoneBudget: number | null): number {
  if (phoneBudget !== null) return (gpu.usable ? 15 : 5) + 45 * clamp((phoneBudget / GIB - 0.5) / 4);
  return chip(gpu).points + 40 * clamp((memoryTotal / GIB - 4) / 12);
}

/** Rates this computer for transcription from 0 to 100: by the speed of recent runs, or before any by its graphics chip and memory. A phone passes its model budget, since the system lets one app use far less than the phone has. */
export function score(gpu: Gpu, memoryTotal: number, speed: number | null, phoneBudget: number | null = null): Score {
  const raw = speed !== null ? 20 * (Math.log2(speed) + 1) : estimate(gpu, memoryTotal, phoneBudget);
  const percent = Math.round(Math.min(100, Math.max(0, raw)));
  const memory = phoneBudget !== null ? "the memory the phone gives the app" : "the memory";
  const basis = speed !== null
    ? `Measured: recent transcriptions ran at ${speed >= 10 ? Math.round(speed) : speed.toFixed(1)} times the speed of the recording.`
    : `Estimated from ${chip(gpu).name} and ${memory}. A transcription of a minute or more replaces the estimate with a measurement.`;
  return { percent, level: percent >= 50 ? "ok" : percent >= 20 ? "warn" : "high", ...tier(percent), speed, basis };
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
