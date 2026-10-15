import { describe, expect, it } from "vitest";
import { estimate, idle, reduce, type RunState } from "./run";

function play(events: Parameters<typeof reduce>[1][]): RunState {
  return events.reduce(reduce, idle);
}

describe("run reducer", () => {
  it("follows the engine from start to done", () => {
    const state = play([
      { type: "start", audio: "/x/meeting.m4a", modelName: "Thai (fast)", now: 1000 },
      { type: "engine", event: { event: "step", step: "decode" }, now: 1001 },
      { type: "engine", event: { event: "audio", seconds: 180 }, now: 1002 },
      { type: "engine", event: { event: "model", device: "metal", threads: 9, language: "th", windows: 14 }, now: 1003 },
      { type: "engine", event: { event: "step", step: "transcribe" }, now: 2000 },
      { type: "engine", event: { event: "line", start: 0, end: 12, text: "a" }, now: 2500 },
      { type: "engine", event: { event: "progress", done: 1, total: 14, position: 12 }, now: 2500 },
      { type: "engine", event: { event: "line", start: 12, end: 24, text: "" }, now: 3000 },
      { type: "engine", event: { event: "progress", done: 2, total: 14, position: 24 }, now: 3000 },
    ]);
    expect(state.status).toBe("running");
    expect(state.total).toBe(14);
    expect(state.lines).toHaveLength(2);
    expect(state.language).toBe("th");
    const e = estimate(state, 3000)!;
    expect(e.remainingSeconds).toBeCloseTo(6, 5);
    expect(e.speed).toBeCloseTo(24, 5);

    const done = reduce(state, { type: "engine", event: { event: "done", lines: 1, elapsed: 9, file: "/x/meeting_transcript.txt" }, now: 4000 });
    expect(done.status).toBe("done");
    expect(done.result?.file).toBe("/x/meeting_transcript.txt");
  });

  it("has no estimate before two windows are done", () => {
    const state = play([
      { type: "start", audio: "a", modelName: "m", now: 0 },
      { type: "engine", event: { event: "step", step: "transcribe" }, now: 10 },
      { type: "engine", event: { event: "progress", done: 1, total: 9, position: 20 }, now: 500 },
    ]);
    expect(estimate(state, 600)).toBeNull();
  });

  it("stops at an error or a cancel and ignores later events", () => {
    const failed = play([
      { type: "start", audio: "a", modelName: "m", now: 0 },
      { type: "engine", event: { event: "error", message: "boom" }, now: 1 },
      { type: "engine", event: { event: "progress", done: 3, total: 9, position: 20 }, now: 2 },
    ]);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("boom");
    expect(failed.done).toBe(0);
    const cancelled = play([
      { type: "start", audio: "a", modelName: "m", now: 0 },
      { type: "engine", event: { event: "cancelled" }, now: 1 },
    ]);
    expect(cancelled.status).toBe("cancelled");
    expect(reduce(cancelled, { type: "reset" })).toEqual(idle);
  });
});
