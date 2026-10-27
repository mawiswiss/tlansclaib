import { describe, expect, it } from "vitest";
import { overdue, usual, type Pace } from "./pace";
import type { HistoryEntry } from "./types";

function entry(extra: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 1, audio: "a.m4a", file: "a.json", model: "Thai Best", language: "th", audio_seconds: 600, lines: 10, elapsed: 60, finished_at: 0,
    status: "done", timestamps: true, exists: true, audio_exists: true, model_id: "thai-best", device: "metal", speaker_backend: "nemotron",
    timings: { decode: 2, speakers: 30, load: 8, transcribe: 40, write: 0.2 }, ...extra,
  };
}

const pace: Pace = { audioSeconds: 1200, modelId: "thai-best", speakerBackend: "nemotron", device: "metal" };

describe("usual", () => {
  it("scales earlier runs on this computer to the recording's length", () => {
    const history = [entry({}), entry({ id: 2, timings: { decode: 2, speakers: 36, load: 10, transcribe: 50, write: 0.2 } })];
    expect(usual("transcribe", pace, history)).toEqual({ seconds: 90, measured: true });
    expect(usual("speakers", pace, history)).toEqual({ seconds: 66, measured: true });
    expect(usual("speakers", { ...pace, audioSeconds: 300 }, history)).toEqual({ seconds: 16.5, measured: true });
    expect(usual("load", pace, history)).toEqual({ seconds: 9, measured: true });
  });

  it("compares the transcription only with runs of the same model on the same device", () => {
    const history = [entry({ device: "cpu", timings: { decode: 2, speakers: 30, load: 8, transcribe: 900, write: 0.2 } })];
    expect(usual("transcribe", pace, history)).toEqual({ seconds: 330, measured: false });
  });

  it("guesses generously without earlier runs, and on the processor more than on a graphics chip", () => {
    expect(usual("load", pace, [])).toEqual({ seconds: 60, measured: false });
    expect(usual("load", { ...pace, device: null }, [])).toEqual({ seconds: 180, measured: false });
    expect(usual("decode", pace, [])).toEqual({ seconds: 120, measured: false });
    expect(usual("speakers", { ...pace, audioSeconds: null }, [])).toBeNull();
  });
});

describe("overdue", () => {
  it("allows half again plus ten seconds over a measured time, and nothing over a guess", () => {
    expect(overdue(145, { seconds: 90, measured: true })).toBe(false);
    expect(overdue(146, { seconds: 90, measured: true })).toBe(true);
    expect(overdue(60, { seconds: 60, measured: false })).toBe(false);
    expect(overdue(61, { seconds: 60, measured: false })).toBe(true);
  });
});
