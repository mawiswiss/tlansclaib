import type { DownloadProgress, EngineEvent, Language, ModelStatus, Stats } from "./types";

export type Unlisten = () => void;

export type Backend = {
  listModels(): Promise<ModelStatus[]>;
  modelsFolder(): Promise<string>;
  downloadModel(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  addModelFile(id: string | null, path: string): Promise<ModelStatus>;
  deleteModel(id: string): Promise<void>;
  reveal(path: string): Promise<void>;
  listLanguages(): Promise<Language[]>;
  startRun(audio: string, modelId: string, language: string, outputDir: string | null): Promise<void>;
  cancelRun(): Promise<void>;
  readTextFile(path: string): Promise<string>;
  autorun(): Promise<string | null>;
  pickAudioFile(): Promise<string | null>;
  pickModelFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  onEngineEvent(handler: (event: EngineEvent) => void): Promise<Unlisten>;
  onStats(handler: (stats: Stats) => void): Promise<Unlisten>;
  onDownloadProgress(handler: (progress: DownloadProgress) => void): Promise<Unlisten>;
  onModelsChanged(handler: () => void): Promise<Unlisten>;
  onDrop(handler: (state: "over" | "leave" | string[]) => void): Promise<Unlisten>;
};

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const AUDIO = ["m4a", "mp3", "wav", "mp4", "flac", "ogg", "aac", "aiff", "caf", "mov", "webm", "mkv"];
  return {
    listModels: () => invoke("list_models"),
    modelsFolder: () => invoke("models_folder"),
    downloadModel: (id) => invoke("download_model", { id }),
    cancelDownload: (id) => invoke("cancel_download", { id }),
    addModelFile: (id, path) => invoke("add_model_file", { id, path }),
    deleteModel: (id) => invoke("delete_model", { id }),
    reveal: (path) => invoke("reveal", { path }),
    listLanguages: () => invoke("list_languages"),
    startRun: (audio, modelId, language, outputDir) =>
      invoke("start_run", { audio, modelId, language, outputDir }),
    cancelRun: () => invoke("cancel_run"),
    readTextFile: (path) => invoke("read_text_file", { path }),
    autorun: () => invoke("autorun"),
    pickAudioFile: async () => {
      const picked = await open({ multiple: false, filters: [{ name: "Audio", extensions: AUDIO }] });
      return typeof picked === "string" ? picked : null;
    },
    pickModelFile: async () => {
      const picked = await open({ multiple: false, filters: [{ name: "whisper.cpp model", extensions: ["bin"] }] });
      return typeof picked === "string" ? picked : null;
    },
    pickFolder: async () => {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    onEngineEvent: (handler) => listen<EngineEvent>("engine-event", (e) => handler(e.payload)),
    onStats: (handler) => listen<Stats>("system-stats", (e) => handler(e.payload)),
    onDownloadProgress: (handler) => listen<DownloadProgress>("download-progress", (e) => handler(e.payload)),
    onModelsChanged: (handler) => listen("models-changed", () => handler()),
    onDrop: (handler) =>
      getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop") handler(event.payload.paths);
        else if (event.payload.type === "leave") handler("leave");
        else handler("over");
      }),
  };
}

let backend: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  if (!backend) {
    backend = isTauri ? tauriBackend() : import("./mock").then((m) => m.mockBackend());
  }
  return backend;
}
