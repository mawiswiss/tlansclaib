import { describe, expect, it } from "vitest";
import { exported } from "./export";

const lines = [
  { start: 0, end: 12.75, text: "first", speaker: 0 },
  { start: 13, end: 14, text: "" },
  { start: 3724.35, end: 3739.25, text: "second", speaker: 1 },
];

describe("exported", () => {
  it("writes text like the desktop transcript", () => {
    expect(exported("txt", lines, true, true, [])).toBe("[00:00:00.00 --> 00:00:12.75] first\n[01:02:04.35 --> 01:02:19.25] second\n");
    expect(exported("txt", lines, false, true, ["Anna", "Ben"])).toBe("Anna: first\nBen: second\n");
  });

  it("numbers SubRip cues and leaves out empty lines", () => {
    expect(exported("srt", lines, true, true, [])).toBe("1\n00:00:00,000 --> 00:00:12,750\nfirst\n\n2\n01:02:04,350 --> 01:02:19,250\nsecond\n\n");
  });

  it("starts WebVTT with its header", () => {
    expect(exported("vtt", lines, true, true, [])).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:12.750\nfirst\n\n01:02:04.350 --> 01:02:19.250\nsecond\n\n");
  });

  it("refuses subtitles without line times", () => {
    expect(() => exported("srt", lines, false, false, [])).toThrow("no line timing");
  });
});
