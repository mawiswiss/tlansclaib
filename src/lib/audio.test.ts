import { describe, expect, it } from "vitest";
import { readInChunks } from "./audio";

const file = Uint8Array.from({ length: 10 }, (_, i) => i);
const reader = (chunk: number, offsets: number[] = []) => async (offset: number) => {
  offsets.push(offset);
  return file.slice(offset, offset + chunk).buffer;
};

describe("readInChunks", () => {
  it("reads the whole file in order", async () => {
    const offsets: number[] = [];
    const blob = await readInChunks(file.length, reader(4, offsets));
    expect(offsets).toEqual([0, 4, 8]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(file);
  });

  it("stops when a file shrank while it was read", async () => {
    const blob = await readInChunks(file.length + 6, reader(4));
    expect(blob.size).toBe(file.length);
  });
});
