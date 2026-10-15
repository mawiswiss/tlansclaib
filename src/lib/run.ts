import type { EngineEvent, Step } from "./types";

export type Line = { start: number; end: number; text: string };

export type RunState = {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  audio: string;
  modelName: string;
  step: Step | null;
  audioSeconds: number | null;
  windows: number | null;
  device: string | null;
  threads: number | null;
  language: string | null;
  lines: Line[];
  done: number;
  total: number;
  position: number;
  startedAt: number;
  transcribeStartedAt: number | null;
  result: { lines: number; elapsed: number; file: string } | null;
  error: string | null;
};

export const idle: RunState = {
  status: "idle",
  audio: "",
  modelName: "",
  step: null,
  audioSeconds: null,
  windows: null,
  device: null,
  threads: null,
  language: null,
  lines: [],
  done: 0,
  total: 0,
  position: 0,
  startedAt: 0,
  transcribeStartedAt: null,
  result: null,
  error: null,
};

export type RunAction =
  | { type: "start"; audio: string; modelName: string; now: number }
  | { type: "engine"; event: EngineEvent; now: number }
  | { type: "fail"; message: string }
  | { type: "reset" };

export function reduce(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return { ...idle, status: "running", audio: action.audio, modelName: action.modelName, startedAt: action.now };
    case "fail":
      return { ...state, status: "error", error: action.message };
    case "reset":
      return idle;
    case "engine": {
      const e = action.event;
      if (state.status !== "running") return state;
      switch (e.event) {
        case "step":
          return {
            ...state,
            step: e.step,
            transcribeStartedAt: e.step === "transcribe" ? action.now : state.transcribeStartedAt,
          };
        case "audio":
          return { ...state, audioSeconds: e.seconds };
        case "model":
          return { ...state, device: e.device, threads: e.threads, language: e.language, windows: e.windows, total: e.windows };
        case "line":
          return { ...state, lines: [...state.lines, { start: e.start, end: e.end, text: e.text }] };
        case "progress":
          return { ...state, done: e.done, total: e.total, position: e.position };
        case "done":
          return { ...state, status: "done", step: null, result: { lines: e.lines, elapsed: e.elapsed, file: e.file } };
        case "error":
          return { ...state, status: "error", error: e.message };
        case "cancelled":
          return { ...state, status: "cancelled" };
      }
    }
  }
  return state;
}

export type Estimate = { remainingSeconds: number; speed: number } | null;

export function estimate(state: RunState, now: number): Estimate {
  if (state.transcribeStartedAt === null || state.done < 2 || state.total === 0) return null;
  const elapsed = (now - state.transcribeStartedAt) / 1000;
  if (elapsed <= 0) return null;
  const perWindow = elapsed / state.done;
  return {
    remainingSeconds: perWindow * (state.total - state.done),
    speed: state.position / elapsed,
  };
}
