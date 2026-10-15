import { describe, expect, it } from "vitest";
import { diskFit, downloadFit, downloadSeconds, level, memoryLevel, ramFit } from "./fit";
import type { Stats } from "./types";

const GIB = 2 ** 30;

function stats(usedGb: number, totalGb = 16): Stats {
  return {
    cpu: 10,
    memory_total: totalGb * GIB,
    memory_used: usedGb * GIB,
    memory_free: (totalGb - usedGb) * GIB,
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
