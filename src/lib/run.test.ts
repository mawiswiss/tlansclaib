import { describe, expect, it } from "vitest";
import { estimate, idle, reduce, type RunState } from "./run";

function play(events: Parameters<typeof reduce>[1][]): RunState {
  return events.reduce(reduce, idle);
}

describe("run reducer", () => {
  it("reports the selected GPU and a CPU retry without ending the run", () => {
    const started = reduce(idle, { type: "start", audio: "/x/meeting.m4a", folder: "/x", modelName: "Thai (fast)", timestamps: true, autoLanguage: false, now: 0 });
    const retry = reduce(started, { type: "engine", event: { event: "retry", message: "Metal could not load the model. Retrying on CPU." }, now: 1 });
    expect(retry.status).toBe("running");
    const cpu = reduce(retry, { type: "engine", event: { event: "model", device: "cpu", threads: 4, language: "en", windows: 1 }, now: 2 });
    expect(cpu.retryReason).toContain("using the CPU");
    expect(cpu.retryReason).toContain("Metal");
    const gpu = reduce(started, { type: "engine", event: { event: "model", device: "vulkan", device_name: "GPU", threads: 4, language: "en", windows: 1 }, now: 2 });
    expect(gpu.deviceName).toBe("GPU");
  });

  it("tracks the part of the model load and forgets it on the next step", () => {
    const loading = play([
      { type: "start", audio: "a.m4a", folder: ".", modelName: "model", timestamps: true, autoLanguage: false, now: 0 },
      { type: "engine", event: { event: "step", step: "load" }, now: 1 },
      { type: "engine", event: { event: "loading", part: "language" }, now: 2 },
    ]);
    expect(loading.loadPart).toBe("language");
    expect(reduce(loading, { type: "engine", event: { event: "step", step: "load" }, now: 3 }).loadPart).toBeNull();
  });

  it("keeps transcribing when an audio track is skipped", () => {
    const started = reduce(idle, { type: "start", audio: "recording.m4a", folder: ".", modelName: "model", timestamps: true, autoLanguage: false, now: 0 });
    const warned = reduce(started, { type: "engine", event: { event: "warning", message: "An audio track was skipped." }, now: 1 });
    expect(warned.status).toBe("running");
  });

  it("follows the engine from start to done", () => {
    const state = play([
      { type: "start", audio: "/x/meeting.m4a", folder: "/x", modelName: "Thai (fast)", timestamps: true, autoLanguage: false, now: 1000 },
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
    expect(done.timestamps).toBe(true);
    expect(done.result?.file).toBe("/x/meeting_transcript.txt");
    expect(reduce(done, { type: "timestamps", on: false }).timestamps).toBe(false);
  });

  it("follows speaker detection and takes the voices it found", () => {
    const state = play([
      { type: "start", audio: "/x/room.m4a", folder: "/x", modelName: "Thai (fast)", timestamps: true, autoLanguage: false, detecting: true, now: 0 },
      { type: "engine", event: { event: "step", step: "speakers" }, now: 1 },
      { type: "engine", event: { event: "speaker_progress", done: 3, total: 12 }, now: 2 },
    ]);
    expect(state.detecting).toBe(true);
    expect(state.speakerProgress).toBe(0.25);
    expect(state.voices).toBeNull();
    const found = reduce(state, { type: "engine", event: { event: "speakers", speakers: ["Speaker 1", "Speaker 2", "Speaker 3"] }, now: 3 });
    expect(found.speakers).toHaveLength(3);
    expect(found.voices).toBe(3);
    expect(found.detected).toBe(true);
    expect(state.detected).toBe(false);
    expect(reduce(state, { type: "engine", event: { event: "speakers", speakers: [] }, now: 3 }).voices).toBe(1);
  });

  it("keeps the speakers of a recording with several tracks and renames them", () => {
    const state = play([
      { type: "start", audio: "/x/call.mp4", folder: "/x", modelName: "All languages (fast)", timestamps: true, autoLanguage: false, now: 0 },
      { type: "engine", event: { event: "audio", seconds: 60, speakers: ["Speaker 1", "Speaker 2"] }, now: 1 },
      { type: "engine", event: { event: "line", start: 0, end: 4, text: "Hello", speaker: 0 }, now: 2 },
      { type: "engine", event: { event: "line", start: 4.5, end: 9, text: "Hi", speaker: 1 }, now: 3 },
    ]);
    expect(state.speakers).toEqual(["Speaker 1", "Speaker 2"]);
    expect(state.lines.map((l) => l.speaker)).toEqual([0, 1]);
    const renamed = reduce(state, { type: "speakers", speakers: ["Marc", "Client"], hash: "h9" });
    expect(renamed.speakers).toEqual(["Marc", "Client"]);
    expect(renamed.hash).toBe("h9");
    expect(play([{ type: "engine", event: { event: "audio", seconds: 60 }, now: 1 }]).speakers).toEqual([]);
  });

  it("has no estimate before two windows are done", () => {
    const state = play([
      { type: "start", audio: "a", folder: "/", modelName: "m", timestamps: false, autoLanguage: true, now: 0 },
      { type: "engine", event: { event: "step", step: "transcribe" }, now: 10 },
      { type: "engine", event: { event: "progress", done: 1, total: 9, position: 20 }, now: 500 },
    ]);
    expect(estimate(state, 600)).toBeNull();
  });

  it("stops at an error or a cancel and ignores later events", () => {
    const failed = play([
      { type: "start", audio: "a", folder: "/", modelName: "m", timestamps: false, autoLanguage: true, now: 0 },
      { type: "engine", event: { event: "error", message: "boom" }, now: 1 },
      { type: "engine", event: { event: "progress", done: 3, total: 9, position: 20 }, now: 2 },
    ]);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("boom");
    expect(failed.done).toBe(0);
    const cancelled = play([
      { type: "start", audio: "a", folder: "/", modelName: "m", timestamps: false, autoLanguage: true, now: 0 },
      { type: "engine", event: { event: "cancelled" }, now: 1 },
    ]);
    expect(cancelled.status).toBe("cancelled");
    expect(reduce(cancelled, { type: "reset" })).toEqual(idle);
  });

  it("keeps what the model heard and starts over on a restart", () => {
    const heard = [{ code: "en", probability: 0.97 }];
    const running = play([
      { type: "start", audio: "/rec/call.m4a", folder: "/", modelName: "m", timestamps: true, autoLanguage: false, now: 0 },
      { type: "engine", event: { event: "model", device: "metal", threads: 4, language: "de", windows: 9, heard }, now: 1 },
      { type: "engine", event: { event: "line", start: 0, end: 5, text: "Hallo" }, now: 2 },
    ]);
    expect(running.heard).toEqual(heard);
    const restarted = reduce(running, { type: "engine", event: { event: "restart", language: "en" }, now: 3 });
    expect(restarted.status).toBe("running");
    expect(restarted.audio).toBe("/rec/call.m4a");
    expect(restarted.lines).toEqual([]);
    expect(restarted.heard).toEqual([]);
    expect(restarted.language).toBeNull();
    expect(restarted.startedAt).toBe(3);
  });

  it("opens a saved transcript as a finished result", () => {
    const entry = {
      id: 1,
      audio: "/rec/meeting.m4a",
      file: "/rec/meeting_transcript.txt",
      model: "Thai (fast)",
      language: "th",
      audio_seconds: 180,
      lines: 2,
      elapsed: 8,
      finished_at: 0,
      status: "done" as const,
      timestamps: true,
      exists: true,
      audio_exists: true,
    };
    const lines = [
      { start: 0, end: 12, text: "a" },
      { start: 12, end: 24, text: "b" },
    ];
    const check = { changed: false, audio: "same" as const };
    const opened = reduce(idle, { type: "open", entry, lines, timestamps: true, check, hash: "h1" });
    expect(opened.status).toBe("done");
    expect(opened.opened).toBe(entry);
    expect(opened.folder).toBe("/rec");
    expect(opened.result).toEqual({ lines: 2, elapsed: 8, file: "/rec/meeting_transcript.txt" });
    expect(reduce(idle, { type: "open", entry, lines, timestamps: false, check, hash: "h1" }).timed).toBe(false);
    expect(opened.hash).toBe("h1");
    const edited = reduce(opened, { type: "edit", index: 1, text: "b, corrected", hash: "h2" });
    expect(edited.lines[1].text).toBe("b, corrected");
    expect(edited.hash).toBe("h2");
    expect(reduce(edited, { type: "edit", index: 0, text: "", hash: "h3" }).result?.lines).toBe(1);
    const moved = reduce({ ...opened, check: { changed: false, audio: "missing" } }, { type: "audio", path: "/new/meeting.m4a" });
    expect(moved.audio).toBe("/new/meeting.m4a");
    expect(moved.check?.audio).toBe("same");
    const renamed = reduce(edited, { type: "rename", file: "/rec/Weekly sync_transcript.txt", title: "Weekly sync" });
    expect(renamed.result?.file).toBe("/rec/Weekly sync_transcript.txt");
    expect(renamed.opened?.file).toBe("/rec/Weekly sync_transcript.txt");
    expect(renamed.hash).toBe("h2");
  });
});
