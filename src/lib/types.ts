export type ModelStatus = {
  id: string;
  name: string;
  title?: string | null;
  languages: string[];
  language_name: string | null;
  setups?: string[] | null;
  recommended: string;
  file: string;
  size_bytes: number;
  sha256: string | null;
  ram_gb: number;
  url: string | null;
  architecture: string | null;
  quantization: string | null;
  source: string | null;
  license: string | null;
  installed: boolean;
  path: string | null;
  label: string | null;
  custom: boolean;
  linked: boolean;
};

export type Language = { code: string; name: string };

export type Heard = { code: string; probability: number };

export type HistoryEntry = {
  id: number;
  audio: string;
  file: string;
  title?: string | null;
  model: string;
  language: string | null;
  audio_seconds: number | null;
  lines: number;
  elapsed: number;
  finished_at: number;
  status: "done" | "incomplete";
  timestamps: boolean;
  speakers?: string[];
  detected?: boolean;
  video?: boolean | null;
  model_id?: string | null;
  speaker_mode?: string | null;
  speaker_precision?: string | null;
  heard?: Heard[];
  speaker_backend?: SpeakerBackend | null;
  exists: boolean;
  audio_exists: boolean;
};

export type Match = "same" | "different" | "unknown" | "missing";

export type Opened = { text: string; lines?: { start: number; end: number; text: string; speaker?: number }[] | null; timestamps?: boolean | null; hash: string; changed: boolean; audio: Match; times?: [number, number][] | null };

export type FileKind = "transcript" | "audio";

export type ExportFormat = "txt" | "srt" | "vtt";

export type Stats = {
  cpu: number;
  memory_total: number;
  memory_used: number;
  memory_free: number;
  swap_total: number;
  swap_used: number;
  app_memory: number;
  engine_memory: number;
};

export type DiskSpace = { free: number; minimum: number; reserve: number };

export type DownloadProgress = { id: string; bytes: number; total: number };

export type Step = "decode" | "speakers" | "load" | "transcribe" | "write";

export type SpeakerBackend = "sherpa" | "nemotron";

export type SpeakerDetection = { backend: SpeakerBackend; available: boolean; installed: boolean; downloading: boolean; download_bytes: number; disk_bytes: number };

export type Gpu = { backend: "metal" | "vulkan" | null; name: string | null; free_bytes: number | null; usable: boolean };

export type Timings = { decode: number; speakers: number; load: number; transcribe: number; write: number };

export type EngineEvent =
  | { event: "step"; step: Step }
  | { event: "audio"; seconds: number; speakers?: string[]; video?: boolean }
  | { event: "model"; device: string; device_name?: string; threads: number; language: string; windows: number; heard?: Heard[] }
  | { event: "line"; start: number; end: number; text: string; speaker?: number }
  | { event: "speakers"; speakers: string[] }
  | { event: "speaker_progress"; done: number; total: number }
  | { event: "progress"; done: number; total: number; position: number }
  | { event: "done"; lines: number; elapsed: number; file: string; timings?: Timings }
  | { event: "error"; message: string }
  | { event: "warning"; message: string }
  | { event: "retry"; message: string }
  | { event: "cancelled" }
  | { event: "restart"; language: string };
