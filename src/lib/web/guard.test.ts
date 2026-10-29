import { describe, expect, it } from "vitest";
import { audioBytes, checkMemory, checkStorage } from "./guard";

const GIB = 2 ** 30;
const PEAK = 4.15 * GIB;

describe("checkMemory", () => {
  it("starts on 8 GB with ten minutes of audio", () => {
    expect(checkMemory(8, PEAK, 600)).toEqual({ kind: "ok" });
  });

  it("refuses 4 GB and names both sizes", () => {
    const check = checkMemory(4, PEAK, 600);
    expect(check.kind).toBe("refuse");
    if (check.kind === "refuse") expect(check.message).toBe("The browser version needs about 5.3 GB of memory, and this computer has 4 GB.");
  });

  it("cannot judge without deviceMemory, which only Chromium reports", () => {
    expect(checkMemory(undefined, PEAK, 600)).toEqual({ kind: "unknown" });
    expect(checkMemory(0, PEAK, 600)).toEqual({ kind: "unknown" });
  });

  it("counts three copies of the decoded audio", () => {
    expect(audioBytes(600)).toBe(600 * 16_000 * 4 * 3);
  });
});

describe("checkStorage", () => {
  it("allows a download that leaves 1 GB", () => {
    expect(checkStorage({ quota: 10 * GIB, usage: 0 }, 0.6 * GIB)).toBeNull();
  });

  it("refuses one that does not", () => {
    expect(checkStorage({ quota: 1.5 * GIB, usage: 0.2 * GIB }, 0.6 * GIB)).toContain("allows 1.3 GB more");
  });

  it("lets the download decide when the browser gives no quota", () => {
    expect(checkStorage(null, 0.6 * GIB)).toBeNull();
    expect(checkStorage({}, 0.6 * GIB)).toBeNull();
  });
});
