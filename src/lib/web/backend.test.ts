import { describe, expect, it } from "vitest";
import { bucketPeaks } from "./backend";

const steady = (seconds: number, amplitude: number) => new Float32Array(seconds * 100).fill(amplitude);

function joined(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
  return out;
}

describe("bucketPeaks", () => {
  it("keeps the rest above half height beside a short loud burst", () => {
    const result = bucketPeaks([joined(steady(30, 0.05), new Float32Array(6).fill(1), steady(30, 0.05))], 30);
    expect(result[15]).toBe(1);
    expect(result.filter((_, bucket) => bucket !== 15).every((level) => level > 0.5)).toBe(true);
  });

  it("sets a bucket 20 dB quieter at half height", () => {
    const result = bucketPeaks([joined(steady(1, 0.5), steady(1, 0.05))], 2);
    expect(result[0]).toBe(1);
    expect(result[1]).toBeCloseTo(0.5, 5);
  });

  it("averages the channels", () => {
    const result = bucketPeaks([joined(steady(1, 0.2), steady(1, 0.2)), joined(steady(1, 0.2), steady(1, 0))], 2);
    expect(result[1]).toBeCloseTo(1 - (10 * Math.log10(2)) / 40, 5);
  });

  it("leaves silence at zero", () => {
    expect(bucketPeaks([new Float32Array(1000)], 10)).toEqual(new Array(10).fill(0));
    expect(bucketPeaks([new Float32Array(0)], 3)).toEqual([0, 0, 0]);
  });
});
