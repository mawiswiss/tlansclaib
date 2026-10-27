import type { HistoryEntry, SpeakerBackend, Step } from "./types";

export type Pace = { audioSeconds: number | null; modelId: string | null; speakerBackend: SpeakerBackend | null; device: string | null };

/** How long a step takes here: measured on earlier runs of this computer, or a generous guess as an upper bound. */
export type Usual = { seconds: number; measured: boolean };

const RECENT = 10;

function guess(step: Step, audio: number, gpu: boolean): number {
  switch (step) {
    case "decode":
      return 120;
    case "speakers":
      return 30 + audio * 0.3;
    case "load":
      return gpu ? 60 : 180;
    case "transcribe":
      return 30 + audio * (gpu ? 0.25 : 4);
    case "write":
      return 30;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function measured(step: Step, pace: Pace, history: HistoryEntry[]): number | null {
  const done = history.filter((e) => e.status === "done" && e.timings);
  const audio = pace.audioSeconds;
  const perAudio = (list: HistoryEntry[], take: (e: HistoryEntry) => number) => {
    const rate = median(list.filter((e) => (e.audio_seconds ?? 0) > 0).slice(0, RECENT).map((e) => take(e) / e.audio_seconds!));
    return rate !== null && audio ? rate * audio : null;
  };
  switch (step) {
    case "decode":
      return null;
    case "speakers":
      return perAudio(done.filter((e) => e.speaker_backend === pace.speakerBackend && e.timings!.speakers > 0), (e) => e.timings!.speakers);
    case "load":
      return median(done.filter((e) => e.model_id === pace.modelId).slice(0, RECENT).map((e) => e.timings!.load));
    case "transcribe":
      return perAudio(done.filter((e) => e.model_id === pace.modelId && e.device === pace.device), (e) => e.timings!.transcribe);
    case "write":
      return median(done.slice(0, RECENT).map((e) => e.timings!.write));
  }
}

export function usual(step: Step, pace: Pace, history: HistoryEntry[]): Usual | null {
  const known = measured(step, pace, history);
  if (known !== null) return { seconds: known, measured: true };
  if (step !== "decode" && step !== "load" && step !== "write" && pace.audioSeconds === null) return null;
  return { seconds: guess(step, pace.audioSeconds ?? 0, pace.device !== null && pace.device !== "cpu"), measured: false };
}

/** Whether a step that has taken, or is heading for, this many seconds runs well past its usual time. */
export function overdue(seconds: number, usual: Usual): boolean {
  return seconds > (usual.measured ? usual.seconds * 1.5 + 10 : usual.seconds);
}
