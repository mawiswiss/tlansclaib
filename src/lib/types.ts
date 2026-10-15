export type ModelStatus = {
  id: string;
  name: string;
  languages: string[];
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
};

export type Language = { code: string; name: string };

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

export type DownloadProgress = { id: string; bytes: number; total: number };

export type Step = "decode" | "load" | "transcribe" | "write";

export type EngineEvent =
  | { event: "step"; step: Step }
  | { event: "audio"; seconds: number }
  | { event: "model"; device: string; threads: number; language: string; windows: number }
  | { event: "line"; start: number; end: number; text: string }
  | { event: "progress"; done: number; total: number; position: number }
  | { event: "done"; lines: number; elapsed: number; file: string }
  | { event: "error"; message: string }
  | { event: "cancelled" };
