import { describe, expect, it } from "vitest";
import { budgetFit, diskFit, downloadFit, downloadSeconds, level, memoryLevel, ramFit, score } from "./fit";
import type { Gpu, Stats } from "./types";

const GIB = 2 ** 30;

function stats(usedGb: number, totalGb = 16): Stats {
  return {
    cpu: 10,
    memory_total: totalGb * GIB,
    memory_used: usedGb * GIB,
    memory_free: (totalGb - usedGb) * GIB,
    model_budget: 0,
    swap_total: 0,
    swap_used: 0,
    app_memory: 0,
    engine_memory: 0,
  };
}

describe("fit", () => {
  it("has three levels: green below 70%, orange up to 90%, red from 90%", () => {
    expect(level(0.69)).toBe("ok");
    expect(level(0.7)).toBe("warn");
    expect(level(0.89)).toBe("warn");
    expect(level(0.9)).toBe("high");
  });

  it("treats little free RAM as red even below 90%", () => {
    expect(memoryLevel(stats(8))).toBe("ok");
    expect(memoryLevel(stats(12))).toBe("warn");
    expect(memoryLevel({ ...stats(5, 6), memory_free: GIB })).toBe("high");
  });

  it("rates a model's RAM need against the computer's total RAM", () => {
    expect(ramFit(1.3, 16 * GIB)).toEqual({ level: "ok", tip: null });
    expect(ramFit(6, 8 * GIB).level).toBe("warn");
    expect(ramFit(7.5, 8 * GIB).level).toBe("high");
    expect(ramFit(20, 8 * GIB).tip).toBe("Needs more RAM than this computer has.");
    expect(budgetFit(1.3, 0.6 * GIB)).toEqual({ level: "high", tip: "Needs more memory than the phone gives the app." });
    expect(budgetFit(0.7, 0.7 * GIB)).toEqual({ level: "ok", tip: null });
  });

  it("rates disk space: red when the model does not fit, orange when less than 10 GB stay free", () => {
    const minimum = GIB;
    const reserve = 10 * GIB;
    expect(diskFit(GIB, 11 * GIB, minimum, reserve).level).toBe("ok");
    expect(diskFit(GIB, 11 * GIB - 1, minimum, reserve).level).toBe("warn");
    expect(diskFit(GIB, 2 * GIB - 1, minimum, reserve).level).toBe("high");
  });

  it("rates the download time: green under 10 minutes, orange under an hour, red above", () => {
    expect(downloadFit(599).level).toBe("ok");
    expect(downloadFit(600).level).toBe("warn");
    expect(downloadFit(3600).level).toBe("high");
    expect(downloadSeconds(600e6, 5e6)).toBe(120);
    expect(downloadSeconds(600e6, 0)).toBe(Infinity);
  });

  it("keeps tooltips free of the chip's own value", () => {
    expect(ramFit(7, 8 * GIB).tip).not.toContain("7");
    expect(diskFit(1.7 * GIB, 5 * GIB, GIB, 10 * GIB).tip).not.toContain("1.7");
    expect(downloadFit(4000).tip).not.toMatch(/\d/);
  });
});

describe("score", () => {
  const chip = (backend: Gpu["backend"], usable = true): Gpu => ({ backend, name: null, free_bytes: null, usable });

  it("estimates from the graphics chip and memory before any run", () => {
    expect(score(chip("metal"), 8 * GIB, null)).toMatchObject({ percent: 73, level: "ok" });
    expect(score(chip("vulkan"), 16 * GIB, null)).toMatchObject({ percent: 95, level: "ok" });
    expect(score(chip(null, false), 8 * GIB, null)).toMatchObject({ percent: 28, level: "warn" });
    expect(score(chip(null, false), 4 * GIB, null)).toMatchObject({ percent: 15, level: "high" });
    expect(score(chip("metal", false), 8 * GIB, null).percent).toBe(28);
  });

  it("rates a phone by the memory it gives the app, not by a Mac's graphics chip", () => {
    expect(score(chip("metal"), 3 * GIB, null, 0.6 * GIB)).toMatchObject({ word: "Slow", bars: 1 });
    expect(score(chip("metal"), 8 * GIB, null, 4.5 * GIB)).toMatchObject({ percent: 60, word: "Fast" });
    expect(score(chip("metal"), 3 * GIB, null, 0.6 * GIB).basis).toContain("the memory the phone gives the app");
    expect(score(chip("metal"), 3 * GIB, 16, 0.6 * GIB).word).toBe("Very fast");
  });

  it("rates by measured speed once there is one", () => {
    expect(score(chip(null, false), 4 * GIB, 16).percent).toBe(100);
    expect(score(chip("metal"), 32 * GIB, 1)).toMatchObject({ percent: 20, level: "warn" });
    expect(score(chip("metal"), 32 * GIB, 0.6).level).toBe("high");
  });

  it("names the speed in a word and fills one to five bars", () => {
    expect(score(chip("metal"), 32 * GIB, 16)).toMatchObject({ word: "Very fast", bars: 5 });
    expect(score(chip("metal"), 8 * GIB, null)).toMatchObject({ word: "Fast", bars: 4 });
    expect(score(chip("vulkan"), 4 * GIB, null)).toMatchObject({ percent: 55, word: "Fast", bars: 3 });
    expect(score(chip(null, false), 8 * GIB, null)).toMatchObject({ word: "Steady", bars: 2 });
    expect(score(chip("metal"), 32 * GIB, 0.1)).toMatchObject({ percent: 0, word: "Slow", bars: 1 });
  });
});
