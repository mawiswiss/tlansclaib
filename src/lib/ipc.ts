import type { Update } from "@tauri-apps/plugin-updater";
import type { Line } from "./run";
import { EXPORT_NAMES } from "./transcript";
import { LARGEST_FILE_BYTES, LIMIT_SECONDS } from "./web/model";
import type { DiskSpace, DownloadProgress, EngineEvent, ExportFormat, FileKind, Gpu, HistoryEntry, Language, Match, ModelStatus, Opened, SpeakerBackend, SpeakerDetection, Stats } from "./types";

export type Unlisten = () => void;

/** What this build offers. `vite --mode web` builds the browser version, which leaves out what only the desktop app has. */
export type Features = {
  lite: boolean;
  speakers: boolean;
  updates: boolean;
  modelCatalog: boolean;
  systemStats: boolean;
  revealFiles: boolean;
  /** Only this many seconds of a recording are transcribed, or all of it. */
  limitSeconds: number | null;
  /** Larger files are refused, or none. */
  largestFileBytes: number | null;
};

const FULL: Features = { lite: false, speakers: true, updates: true, modelCatalog: true, systemStats: true, revealFiles: true, limitSeconds: null, largestFileBytes: null };

const LITE: Features = { lite: true, speakers: false, updates: false, modelCatalog: false, systemStats: false, revealFiles: false, limitSeconds: LIMIT_SECONDS, largestFileBytes: LARGEST_FILE_BYTES };

export const FEATURES = import.meta.env.MODE === "web" ? LITE : FULL;

export type Backend = {
  listModels(): Promise<ModelStatus[]>;
  modelsFolder(): Promise<string>;
  downloadModel(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  addModelFile(id: string | null, path: string): Promise<ModelStatus>;
  deleteModel(id: string): Promise<void>;
  unlinkModel(id: string): Promise<void>;
  renameModel(id: string, name: string): Promise<void>;
  reveal(path: string): Promise<void>;
  listLanguages(): Promise<Language[]>;
  audioSeconds(path: string): Promise<number | null>;
  startRun(
    audio: string,
    modelId: string,
    language: string,
    timestamps: boolean,
    speakers: string | null,
    speakerPrecision: string | null,
    speakerBackend: SpeakerBackend | null,
    outputFile?: string | null,
    force?: boolean,
  ): Promise<void>;
  speakerDetection(): Promise<SpeakerDetection[]>;
  downloadSpeakerDetection(backend: SpeakerBackend): Promise<void>;
  cancelSpeakerDetection(backend: SpeakerBackend): Promise<void>;
  removeSpeakerDetection(backend: SpeakerBackend): Promise<void>;
  cancelRun(): Promise<void>;
  restartRun(language: string): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  removeHistory(id: number): Promise<void>;
  setTranscriptTimestamps(file: string, lines: Line[], timestamps: boolean, speakers: string[]): Promise<string>;
  saveTranscript(file: string, expected: string, lines: Line[], timestamps: boolean, speakers: string[]): Promise<string>;
  transcriptHash(file: string): Promise<string>;
  exportTranscript(file: string, expected: string, destination: string, lines: Line[], timestamps: boolean, timed: boolean, speakers: string[]): Promise<void>;
  renameTranscript(file: string, title: string): Promise<string>;
  openHistory(id: number): Promise<Opened>;
  checkCandidate(id: number, kind: FileKind, path: string): Promise<Match>;
  relocateHistory(id: number, kind: FileKind, path: string): Promise<void>;
  audioUrl(path: string): Promise<string>;
  confirm(message: string, ok: string): Promise<boolean>;
  log(level: "info" | "warn", message: string): void;
  openUrl(url: string): Promise<void>;
  appVersion(): Promise<string>;
  diskSpace(): Promise<DiskSpace>;
  measureSpeed(): Promise<number>;
  checkUpdate(): Promise<string | null>;
  updateBlocker(): Promise<string | null>;
  downloadUpdate(onProgress: (received: number, total: number | null) => void): Promise<void>;
  installUpdate(): Promise<void>;
  gpuInfo(modelId: string | null): Promise<Gpu>;
  checkSetupDownloads(modelIds: string[], backend: SpeakerBackend | null): Promise<number>;
  autorun(): Promise<string | null>;
  pickAudioFile(): Promise<string | null>;
  pickModelFile(): Promise<string | null>;
  pickTranscriptFile(): Promise<string | null>;
  pickExportFile(name: string, format: ExportFormat): Promise<string | null>;
  onEngineEvent(handler: (event: EngineEvent) => void): Promise<Unlisten>;
  onStats(handler: (stats: Stats) => void): Promise<Unlisten>;
  onDownloadProgress(handler: (progress: DownloadProgress) => void): Promise<Unlisten>;
  onAppError(handler: (message: string) => void): Promise<Unlisten>;
  onModelsChanged(handler: () => void): Promise<Unlisten>;
  onHistoryChanged(handler: () => void): Promise<Unlisten>;
  onDrop(handler: (state: "over" | "leave" | string[]) => void): Promise<Unlisten>;
};

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const { open } = await import("@tauri-apps/plugin-dialog");
  let update: Update | null = null;
  const AUDIO = ["m4a", "mp3", "wav", "mp4", "flac", "ogg", "aac", "aiff", "caf", "mov", "webm", "mkv"];
  return {
    listModels: () => invoke("list_models"),
    modelsFolder: () => invoke("models_folder"),
    downloadModel: (id) => invoke("download_model", { id }),
    cancelDownload: (id) => invoke("cancel_download", { id }),
    addModelFile: (id, path) => invoke("add_model_file", { id, path }),
    deleteModel: (id) => invoke("delete_model", { id }),
    unlinkModel: (id) => invoke("unlink_model", { id }),
    renameModel: (id, name) => invoke("rename_model", { id, name }),
    reveal: (path) => invoke("reveal", { path }),
    listLanguages: () => invoke("list_languages"),
    audioSeconds: async () => null,
    startRun: (audio, modelId, language, timestamps, speakers, speakerPrecision, speakerBackend, outputFile, force) =>
      invoke("start_run", { audio, modelId, language, timestamps, speakers, speakerPrecision, speakerBackend, outputFile: outputFile ?? null, force: force ?? false }),
    speakerDetection: () => invoke("speaker_detection"),
    downloadSpeakerDetection: (backend) => invoke("download_speaker_detection", { backend }),
    cancelSpeakerDetection: (backend) => invoke("cancel_speaker_detection", { backend }),
    removeSpeakerDetection: (backend) => invoke("remove_speaker_detection", { backend }),
    cancelRun: () => invoke("cancel_run"),
    restartRun: (language) => invoke("restart_run", { language }),
    listHistory: () => invoke("list_history"),
    removeHistory: (id) => invoke("remove_history", { id }),
    setTranscriptTimestamps: (file, lines, timestamps, speakers) => invoke("set_transcript_timestamps", { file, lines, timestamps, speakers }),
    saveTranscript: (file, expected, lines, timestamps, speakers) => invoke("save_transcript", { file, expected, lines, timestamps, speakers }),
    transcriptHash: (file) => invoke("transcript_hash", { file }),
    exportTranscript: (file, expected, destination, lines, timestamps, timed, speakers) => invoke("export_transcript", { file, expected, destination, lines, timestamps, timed, speakers }),
    renameTranscript: (file, title) => invoke("rename_transcript", { file, title }),
    openHistory: (id) => invoke("open_history", { id }),
    checkCandidate: (id, kind, path) => invoke("check_candidate", { id, kind, path }),
    relocateHistory: (id, kind, path) => invoke("relocate_history", { id, kind, path }),
    audioUrl: async (path) => {
      await invoke("audio_source", { path });
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return convertFileSrc(path);
    },
    confirm: async (message, ok) => {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      return ask(message, { title: "tlansclaib", kind: "warning", okLabel: ok, cancelLabel: "Cancel" });
    },
    log: (level, message) => {
      import("@tauri-apps/plugin-log").then((l) => (level === "warn" ? l.warn(message) : l.info(message))).catch(() => {});
    },
    openUrl: (url) => invoke("open_url", { url }),
    appVersion: async () => (await import("@tauri-apps/api/app")).getVersion(),
    diskSpace: () => invoke("disk_space"),
    measureSpeed: () => invoke("measure_speed"),
    checkUpdate: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      update = await check();
      return update?.version ?? null;
    },
    updateBlocker: () => invoke("update_blocker"),
    downloadUpdate: async (onProgress) => {
      if (!update) throw new Error("Check for updates first.");
      let received = 0;
      let total: number | null = null;
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") onProgress((received += event.data.chunkLength), total);
      });
    },
    installUpdate: async () => {
      if (!update) throw new Error("Check for updates first.");
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
    gpuInfo: (modelId) => invoke("gpu_info", { modelId }),
    checkSetupDownloads: (modelIds, backend) => invoke("check_setup_downloads", { modelIds, backend }),
    autorun: () => invoke("autorun"),
    pickAudioFile: async () => {
      const picked = await open({ multiple: false, filters: [{ name: "Audio", extensions: AUDIO }] });
      return typeof picked === "string" ? picked : null;
    },
    pickModelFile: async () => {
      const picked = await open({ multiple: false, filters: [{ name: "whisper.cpp model", extensions: ["bin"] }] });
      return typeof picked === "string" ? picked : null;
    },
    pickTranscriptFile: async () => {
      const picked = await open({ multiple: false, filters: [{ name: "Transcript", extensions: ["txt"] }] });
      return typeof picked === "string" ? picked : null;
    },
    pickExportFile: async (name, format) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return save({ defaultPath: `${name}.${format}`, filters: [{ name: EXPORT_NAMES[format], extensions: [format] }] });
    },
    onEngineEvent: (handler) => listen<EngineEvent>("engine-event", (e) => handler(e.payload)),
    onStats: (handler) => listen<Stats>("system-stats", (e) => handler(e.payload)),
    onDownloadProgress: (handler) => listen<DownloadProgress>("download-progress", (e) => handler(e.payload)),
    onAppError: (handler) => listen<string>("app-error", (e) => handler(e.payload)),
    onModelsChanged: (handler) => listen("models-changed", () => handler()),
    onHistoryChanged: (handler) => listen("history-changed", () => handler()),
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
    backend = import.meta.env.MODE === "web"
      ? import("./web/backend").then((m) => m.webBackend())
      : isTauri ? tauriBackend() : import("./mock").then((m) => m.mockBackend());
  }
  return backend;
}
