import type { EngineEvent, Heard, HistoryEntry, LoadPart, Match, Step, Timings } from "./types";
import { titleOf } from "./format";

export type Word = { start: number; end: number; text: string };

export type Line = { start: number; end: number; text: string; speaker?: number; words?: Word[] };

export type StartError =
  | { kind: "memory"; message: string; free: number; budget: number | null; budget_without_speakers: number | null }
  | { kind: "other"; message: string };

export function startError(error: unknown): StartError {
  if (typeof error === "object" && error !== null && "kind" in error && "message" in error) return error as StartError;
  return { kind: "other", message: String(error) };
}

export type RunState = {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  audio: string;
  title: string;
  folder: string;
  modelName: string;
  timestamps: boolean;
  autoLanguage: boolean;
  step: Step | null;
  loadPart: LoadPart | null;
  audioSeconds: number | null;
  speakers: string[];
  tracks: number;
  detecting: boolean;
  speakerProgress: number | null;
  voices: number | null;
  detected: boolean;
  video: boolean | null;
  windows: number | null;
  device: string | null;
  deviceName: string | null;
  retryReason: string | null;
  tooHeavy: string | null;
  timings: Timings | null;
  threads: number | null;
  language: string | null;
  heard: Heard[];
  lines: Line[];
  done: number;
  total: number;
  position: number;
  startedAt: number;
  transcribeStartedAt: number | null;
  result: { lines: number; elapsed: number; file: string } | null;
  error: string | null;
  opened: HistoryEntry | null;
  timed: boolean;
  check: { changed: boolean; audio: Match } | null;
  hash: string | null;
  finishedAt: number | null;
};

export const idle: RunState = {
  status: "idle",
  audio: "",
  title: "",
  folder: "",
  modelName: "",
  timestamps: true,
  autoLanguage: false,
  step: null,
  loadPart: null,
  audioSeconds: null,
  speakers: [],
  tracks: 1,
  detecting: false,
  speakerProgress: null,
  voices: null,
  detected: false,
  video: null,
  windows: null,
  device: null,
  deviceName: null,
  retryReason: null,
  tooHeavy: null,
  timings: null,
  threads: null,
  language: null,
  heard: [],
  lines: [],
  done: 0,
  total: 0,
  position: 0,
  startedAt: 0,
  transcribeStartedAt: null,
  result: null,
  error: null,
  opened: null,
  timed: true,
  check: null,
  hash: null,
  finishedAt: null,
};

export type RunAction =
  | { type: "start"; audio: string; folder: string; modelName: string; timestamps: boolean; autoLanguage: boolean; detecting?: boolean; now: number }
  | { type: "timestamps"; on: boolean }
  | {
      type: "open";
      entry: HistoryEntry;
      lines: Line[];
      timestamps: boolean;
      timed?: boolean;
      check: { changed: boolean; audio: Match };
      hash: string;
    }
  | { type: "hash"; hash: string }
  | { type: "edit"; lines: Line[]; speakers: string[]; hash: string }
  | { type: "audio"; path: string }
  | { type: "rename"; file: string; title: string }
  | { type: "engine"; event: EngineEvent; now: number }
  | { type: "fail"; message: string }
  | { type: "reset" };

export function reduce(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return {
        ...idle,
        status: "running",
        audio: action.audio,
        title: action.audio.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Recording",
        folder: action.folder,
        modelName: action.modelName,
        timestamps: action.timestamps,
        autoLanguage: action.autoLanguage,
        detecting: action.detecting ?? false,
        startedAt: action.now,
      };
    case "timestamps":
      return { ...state, timestamps: action.on };
    case "open": {
      const e = action.entry;
      const i = Math.max(e.file.lastIndexOf("/"), e.file.lastIndexOf("\\"));
      return {
        ...idle,
        status: "done",
        audio: e.audio,
        title: e.title ?? titleOf(e.file),
        folder: i > 0 ? e.file.slice(0, i) : e.file,
        modelName: e.model,
        language: e.language,
        heard: e.heard ?? [],
        audioSeconds: e.audio_seconds,
        speakers: e.speakers ?? [],
        tracks: e.tracks ?? (e.detected ? 1 : Math.max(1, (e.speakers ?? []).length)),
        detected: e.detected ?? false,
        voices: e.detected ? Math.max(1, (e.speakers ?? []).length) : null,
        video: e.video ?? null,
        lines: action.lines,
        timestamps: action.timestamps,
        timed: action.timed ?? action.timestamps,
        result: { lines: action.lines.filter((l) => l.text).length, elapsed: e.elapsed, file: e.file },
        opened: e,
        check: action.check,
        hash: action.hash,
        finishedAt: e.finished_at * 1000,
      };
    }
    case "hash":
      return { ...state, hash: action.hash };
    case "edit":
      return {
        ...state,
        hash: action.hash,
        lines: action.lines,
        speakers: action.speakers,
        result: state.result && { ...state.result, lines: action.lines.filter((l) => l.text).length },
      };
    case "audio":
      return { ...state, audio: action.path, check: state.check && { ...state.check, audio: "same" } };
    case "rename":
      return {
        ...state,
        title: action.title,
        result: state.result && { ...state.result, file: action.file },
        opened: state.opened && { ...state.opened, file: action.file, title: action.title },
      };
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
            loadPart: null,
            transcribeStartedAt: e.step === "transcribe" ? action.now : state.transcribeStartedAt,
          };
        case "loading":
          return { ...state, loadPart: e.part };
        case "audio":
          return { ...state, audioSeconds: e.seconds, speakers: e.speakers ?? [], tracks: Math.max(1, e.speakers?.length ?? 0), video: e.video ?? false };
        case "model":
          return { ...state, device: e.device, deviceName: e.device_name ?? null, retryReason: state.retryReason && e.device === "cpu" ? state.retryReason.replace("Retrying on CPU.", "This run is using the CPU.") : state.retryReason, threads: e.threads, language: e.language, heard: e.heard ?? [], windows: e.windows, total: e.windows };
        case "retry":
          return { ...state, retryReason: e.message };
        case "too_heavy":
          return { ...state, tooHeavy: e.model_id };
        case "line":
          return { ...state, lines: [...state.lines, { start: e.start, end: e.end, text: e.text, speaker: e.speaker, words: e.words }] };
        case "speakers":
          return { ...state, speakers: e.speakers, voices: Math.max(1, e.speakers.length), detected: true };
        case "speaker_progress":
          return { ...state, speakerProgress: e.total > 0 ? e.done / e.total : null };
        case "progress":
          return { ...state, done: e.done, total: e.total, position: e.position };
        case "done":
          return {
            ...state,
            status: "done",
            step: null,
            finishedAt: action.now,
            result: { lines: e.lines, elapsed: e.elapsed, file: e.file },
            timings: e.timings ?? null,
          };
        case "error":
          return { ...state, status: "error", error: e.message };
        case "warning":
          return state;
        case "cancelled":
          return { ...state, status: "cancelled" };
        case "restart":
          return {
            ...idle,
            status: "running",
            audio: state.audio,
            title: state.title,
            folder: state.folder,
            modelName: state.modelName,
            timestamps: state.timestamps,
            detecting: state.detecting,
            startedAt: action.now,
          };
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
