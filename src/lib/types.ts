export type ModelStatus = {
  id: string;
  name: string;
  title?: string | null;
  languages: string[];
  language_name: string | null;
  recommended: string;
  featured: boolean;
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

export type HistoryEntry = {
  id: number;
  audio: string;
  file: string;
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
  exists: boolean;
  audio_exists: boolean;
};

export type Match = "same" | "different" | "unknown" | "missing";

export type Opened = { text: string; hash: string; changed: boolean; audio: Match; times?: [number, number][] | null };

export type FileKind = "transcript" | "audio";

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

export type SpeakerDetection = { available: boolean; installed: boolean; downloading: boolean; download_bytes: number; disk_bytes: number };

export type EngineEvent =
  | { event: "step"; step: Step }
  | { event: "audio"; seconds: number; speakers?: string[]; video?: boolean }
  | { event: "model"; device: string; threads: number; language: string; windows: number }
  | { event: "line"; start: number; end: number; text: string; speaker?: number }
  | { event: "speakers"; speakers: string[] }
  | { event: "speaker_progress"; done: number; total: number }
  | { event: "progress"; done: number; total: number; position: number }
  | { event: "done"; lines: number; elapsed: number; file: string }
  | { event: "error"; message: string }
  | { event: "cancelled" };
