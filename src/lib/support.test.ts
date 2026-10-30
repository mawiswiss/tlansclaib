import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./settings";
import { askedForSupport, countFromHistory, countOne, shouldAskForSupport } from "./support";
import type { HistoryEntry } from "./types";

function entry(status: HistoryEntry["status"]): HistoryEntry {
  return {
    id: Math.random(),
    audio: "/a.m4a",
    file: "/a_transcript.txt",
    model: "Thai Compact",
    language: "th",
    audio_seconds: 60,
    lines: 4,
    elapsed: 3,
    finished_at: 0,
    status,
    timestamps: true,
    exists: true,
    audio_exists: true,
  };
}

describe("support nudge", () => {
  it("asks after the tenth finished transcription, then after every 25 more", () => {
    let s = DEFAULTS;
    for (let i = 0; i < 9; i++) s = countOne(s);
    expect(shouldAskForSupport(s)).toBe(false);
    s = countOne(s);
    expect(shouldAskForSupport(s)).toBe(true);
    s = askedForSupport(s);
    for (let i = 0; i < 24; i++) s = countOne(s);
    expect(shouldAskForSupport(s)).toBe(false);
    s = countOne(s);
    expect(s.transcribed).toBe(35);
    expect(shouldAskForSupport(s)).toBe(true);
  });

  it("never asks again once the user chose to support", () => {
    let s = { ...DEFAULTS, supported: true };
    for (let i = 0; i < 100; i++) s = countOne(s);
    expect(shouldAskForSupport(s)).toBe(false);
  });

  it("starts counting from the finished transcripts already in the history", () => {
    const history = [...Array(11)].map(() => entry("done")).concat([entry("incomplete")]);
    const seeded = countFromHistory(DEFAULTS, history);
    expect(seeded.transcribed).toBe(11);
    expect(countFromHistory({ ...DEFAULTS, transcribed: 3 }, history).transcribed).toBe(3);
  });
});
