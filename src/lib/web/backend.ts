import type { Backend } from "../ipc";
import type { Line } from "../run";
import type { EngineEvent, HistoryEntry, ModelStatus } from "../types";
import { exported } from "./export";
import { checkMemory, checkStorage } from "./guard";
import { languages } from "./languages";
import { DOWNLOAD_BYTES, LARGEST_FILE_BYTES, LIMIT_SECONDS, MODEL_ID, PEAK_BYTES } from "./model";
import * as records from "./records";
import { Refusal } from "./refusal";
import * as store from "./store";
import type { Reply, Request } from "./worker";

const MODEL = "universal-turbo-web";
const HEAVY = "tlansclaib.too-heavy";
const RATE = 16_000;

/** Why this browser cannot run the lite version, or null when it can. */
export async function unsupported(): Promise<string | null> {
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return "The browser version runs on a computer, not on a phone or tablet.";
  if (typeof navigator.storage?.getDirectory !== "function" || typeof FileSystemFileHandle === "undefined" || !("createWritable" in FileSystemFileHandle.prototype))
    return "This browser cannot store the model on this computer.";
  if (!("gpu" in navigator)) return "This browser has no WebGPU, which the browser version needs to run the model on the graphics chip.";
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return "This browser offers no graphics chip for WebGPU, which the browser version needs.";
  if (!adapter.features.has("shader-f16")) return "This computer's graphics chip lacks 16-bit floating point in WebGPU, which the model needs.";
  return null;
}

function tooHeavy(): string | null {
  try {
    return localStorage.getItem(HEAVY);
  } catch {
    return null;
  }
}

function markHeavy(reason: string | null) {
  try {
    if (reason) localStorage.setItem(HEAVY, reason);
    else localStorage.removeItem(HEAVY);
  } catch {
    // Without storage the mark lasts only this session.
  }
}

function model(installed: boolean): ModelStatus {
  return {
    id: MODEL,
    name: "Universal",
    languages: ["all"],
    language_name: null,
    setups: null,
    recommended: "Whisper large-v3 turbo, quantized for the browser. Recordings in about 100 languages.",
    file: "whisper-large-v3-turbo q4f16",
    size_bytes: DOWNLOAD_BYTES,
    sha256: null,
    ram_gb: Math.round((PEAK_BYTES / 2 ** 30) * 10) / 10,
    quality: 3,
    url: `https://huggingface.co/${MODEL_ID}`,
    architecture: "large-v3-turbo",
    quantization: "q4f16",
    source: `https://huggingface.co/${MODEL_ID}`,
    license: "MIT",
    installed,
    path: null,
    label: "large-v3-turbo, q4f16",
    custom: false,
    linked: false,
    too_heavy: tooHeavy(),
  };
}

function duration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const done = (seconds: number | null) => {
      URL.revokeObjectURL(url);
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => done(media.duration);
    media.onerror = () => done(null);
    media.src = url;
  });
}

/** Why the browser version cannot read this file before trying, or null. */
function tooLarge(file: File): string | null {
  if (file.size <= LARGEST_FILE_BYTES) return null;
  return `${file.name} is ${(file.size / 2 ** 30).toFixed(1)} GB. The browser version reads files up to 1 GB, because it loads the whole file into memory. The desktop app reads recordings of any size.`;
}

async function contents(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch {
    throw new Refusal(
      `The browser cannot read ${file.name}. A file in Google Drive, iCloud Drive, OneDrive or Dropbox must be stored on this computer: make it available offline, or copy it to a local folder, then choose it again.`,
    );
  }
}

/** 16 kHz mono, the first `LIMIT_SECONDS`. The browser resamples while it decodes. */
async function decode(file: File): Promise<{ samples: Float32Array; seconds: number }> {
  const data = await contents(file);
  const context = new AudioContext({ sampleRate: RATE });
  try {
    const buffer = await context.decodeAudioData(data).catch(() => {
      throw new Refusal(
        `This browser cannot read the sound in ${file.name}. MP3, M4A, WAV and FLAC work in every browser. The desktop app also reads the video formats a browser cannot.`,
      );
    });
    const length = Math.min(buffer.length, LIMIT_SECONDS * RATE);
    const samples = new Float32Array(length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += channel[i] / buffer.numberOfChannels;
    }
    return { samples, seconds: buffer.duration };
  } finally {
    void context.close();
  }
}

function pick(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,video/*,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aac,.mp4,.mov,.webm";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function webBackend(): Backend {
  const target = new EventTarget();
  const emit = (name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
  const on = <T,>(name: string, handler: (detail: T) => void) => {
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
    target.addEventListener(name, listener);
    return Promise.resolve(() => target.removeEventListener(name, listener));
  };
  const files = new Map<string, File>();
  const urls = new Map<string, string>();
  const remember = (file: File) => {
    const id = `browser:${crypto.randomUUID()}/${file.name}`;
    files.set(id, file);
    return id;
  };
  let download: AbortController | null = null;
  let worker: Worker | null = null;
  let generation = 0;
  let current: { run: number; args: Parameters<Backend["startRun"]>; lines: Line[]; started: number; decode: number; seconds: number; language: string; heard: HistoryEntry["heard"] } | null = null;

  const entries = async (): Promise<HistoryEntry[]> =>
    (await records.all()).map((r) => ({ ...r.entry, exists: true, audio_exists: files.has(r.entry.audio) }));

  const record = async (file: string) => {
    const found = await records.get(records.idOf(file));
    if (!found) throw new Refusal("This transcript is no longer in the browser's history.");
    return found;
  };

  const persist = async (run: NonNullable<typeof current>, status: "done" | "incomplete", timings: HistoryEntry["timings"]) => {
    const [audio, , , timestamps, , , , outputFile] = run.args;
    const replaced = outputFile ? await records.get(records.idOf(outputFile)).catch(() => undefined) : undefined;
    const id = Date.now();
    const elapsed = (performance.now() - run.started) / 1000;
    await records.put({
      entry: {
        id,
        audio,
        file: records.fileOf(id),
        title: replaced?.entry.title ?? audio.split("/").pop()!.replace(/\.[^.]+$/, ""),
        model: "Universal",
        model_id: MODEL,
        language: run.language,
        audio_seconds: run.seconds,
        lines: run.lines.filter((l) => l.text).length,
        elapsed,
        finished_at: Math.floor(Date.now() / 1000),
        status,
        timestamps,
        speakers: [],
        heard: run.heard,
        device: "webgpu",
        timings,
        edited: false,
      },
      lines: run.lines,
      revision: 1,
      audio_size: files.get(audio)?.size ?? 0,
    });
    if (replaced) await records.remove(replaced.entry.id);
    emit("history", null);
    return { id, elapsed };
  };

  const startWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (message: MessageEvent<Reply>) => {
      const reply = message.data;
      const run = current;
      if (!run || reply.run !== run.run || reply.run !== generation) return;
      if (reply.type === "log") console.warn(reply.message);
      if (reply.type === "event") {
        if (reply.event.event === "line") run.lines.push({ start: reply.event.start, end: reply.event.end, text: reply.event.text });
        if (reply.event.event === "model") {
          run.language = reply.event.language;
          run.heard = reply.event.heard;
        }
        emit("engine", reply.event);
        if (reply.event.event === "error") current = null;
      }
      if (reply.type === "finished") {
        emit("engine", { event: "step", step: "write" } satisfies EngineEvent);
        const write = performance.now();
        current = null;
        markHeavy(null);
        void persist(run, "done", { decode: run.decode, speakers: 0, load: reply.load, transcribe: reply.transcribe, write: 0 })
          .then(({ id, elapsed }) =>
            emit("engine", {
              event: "done",
              lines: run.lines.filter((l) => l.text).length,
              elapsed,
              file: records.fileOf(id),
              timings: { decode: run.decode, speakers: 0, load: reply.load, transcribe: reply.transcribe, write: (performance.now() - write) / 1000 },
            } satisfies EngineEvent),
          )
          .catch((error) => emit("engine", { event: "error", message: `Could not save the transcript in the browser: ${String(error)}` } satisfies EngineEvent));
      }
    };
    worker.onerror = (error) => {
      worker?.terminate();
      worker = null;
      if (!current) return;
      current = null;
      markHeavy("The browser stopped the model while it transcribed.");
      emit("models", null);
      emit("engine", { event: "too_heavy", model_id: MODEL } satisfies EngineEvent);
      emit("engine", { event: "error", message: `The browser stopped the transcription: ${error.message || "the model ran out of memory or the graphics chip reset"}.` } satisfies EngineEvent);
    };
    return worker;
  };

  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };

  const backend: Backend = {
    listModels: async () => [model(await store.isInstalled())],
    modelsFolder: async () => "",
    downloadModel: async (id) => {
      if (id !== MODEL) throw new Refusal("The browser version has one model.");
      const refused = checkStorage(await navigator.storage?.estimate?.().catch(() => null), (await store.isInstalled()) ? 0 : DOWNLOAD_BYTES);
      if (refused) throw new Refusal(refused);
      download = new AbortController();
      try {
        await store.install(download.signal, (bytes, total) => emit("download", { id, bytes, total }));
        await navigator.storage?.persist?.().catch(() => false);
      } catch (error) {
        if (download.signal.aborted) return;
        throw error;
      } finally {
        download = null;
        emit("models", null);
      }
    },
    cancelDownload: async () => download?.abort(),
    addModelFile: async () => {
      throw new Refusal("The browser version cannot add model files. The desktop app can.");
    },
    deleteModel: async () => {
      stopWorker();
      await store.remove();
      markHeavy(null);
      emit("models", null);
    },
    unlinkModel: async () => {},
    renameModel: async () => {},
    reveal: async () => {},
    listLanguages: async () => languages,
    audioSeconds: async (path) => {
      const file = files.get(path);
      return file ? duration(file) : null;
    },
    startRun: async (...args) => {
      const [audio, , language, , , , , , force] = args;
      const file = files.get(audio);
      if (!file) throw new Refusal("Choose the recording again: the browser forgets files when the page reloads.");
      const problem = (await unsupported()) ?? tooLarge(file);
      if (problem) throw new Refusal(problem);
      if (!(await store.isInstalled())) throw new Refusal("The model is not downloaded yet.");
      const length = Math.min((await duration(file)) ?? LIMIT_SECONDS, LIMIT_SECONDS);
      const memory = checkMemory((navigator as Navigator & { deviceMemory?: number }).deviceMemory, PEAK_BYTES, length);
      if (memory.kind === "refuse" && !force) throw { kind: "memory", message: memory.message, free: memory.total, budget: null, budget_without_speakers: null };
      const run = ++generation;
      const started = performance.now();
      current = { run, args, lines: [], started, decode: 0, seconds: 0, language, heard: [] };
      const state = current;
      const send = (event: EngineEvent) => {
        if (run === generation) emit("engine", event);
      };
      send({ event: "step", step: "decode" });
      void decode(file)
        .then(({ samples, seconds }) => {
          if (run !== generation) return;
          state.decode = (performance.now() - started) / 1000;
          state.seconds = samples.length / RATE;
          send({ event: "audio", seconds: samples.length / RATE, full: seconds, video: file.type.startsWith("video/") });
          startWorker().postMessage({ type: "run", run, audio: samples, language } satisfies Request, [samples.buffer]);
        })
        .catch((error) => {
          if (run !== generation) return;
          current = null;
          send({ event: "error", message: error instanceof Error ? error.message : String(error) });
        });
    },
    speakerDetection: async () => [],
    downloadSpeakerDetection: async () => {},
    cancelSpeakerDetection: async () => {},
    removeSpeakerDetection: async () => {},
    cancelRun: async () => {
      const run = current;
      current = null;
      generation += 1;
      if (run) worker?.postMessage({ type: "cancel", run: run.run } satisfies Request);
      if (run && run.lines.some((l) => l.text)) await persist(run, "incomplete", null).catch((error) => emit("app-error", `Could not keep the finished lines: ${String(error)}`));
      emit("engine", { event: "cancelled" } satisfies EngineEvent);
    },
    async restartRun(language) {
      const run = current;
      current = null;
      generation += 1;
      if (run) worker?.postMessage({ type: "cancel", run: run.run } satisfies Request);
      emit("engine", { event: "restart", language } satisfies EngineEvent);
      if (!run) return;
      const [audio, modelId, , timestamps, speakers, precision, speakerBackend, outputFile, force] = run.args;
      await this.startRun(audio, modelId, language, timestamps, speakers, precision, speakerBackend, outputFile, force);
    },
    listHistory: entries,
    removeHistory: async (id) => {
      await records.remove(id);
      emit("history", null);
    },
    setTranscriptTimestamps: async (file, lines, timestamps) => {
      const found = await record(file);
      await records.put({ ...found, lines, entry: { ...found.entry, timestamps }, revision: found.revision + 1 });
      emit("history", null);
      return `r${found.revision + 1}`;
    },
    saveTranscript: async (file, expected, lines, timestamps, speakers) => {
      const found = await record(file);
      if (expected !== `r${found.revision}`) throw new Refusal("This transcript was changed in another tab since it was opened, so the edit was not saved.");
      await records.put({ ...found, lines, entry: { ...found.entry, timestamps, speakers, edited: true }, revision: found.revision + 1 });
      emit("history", null);
      return `r${found.revision + 1}`;
    },
    transcriptHash: async (file) => `r${(await record(file)).revision}`,
    exportTranscript: async (file, expected, destination, lines, timestamps, timed, speakers) => {
      if (expected !== (await backend.transcriptHash(file))) throw new Refusal("This transcript changed since it was opened. Open it again before exporting.");
      const format = destination.split(".").pop() as "txt" | "srt" | "vtt";
      save(destination, exported(format, lines, timestamps, timed, speakers));
    },
    renameTranscript: async (file, title) => {
      const name = title.trim();
      if (!name) throw new Refusal("The title cannot be empty.");
      const found = await record(file);
      await records.put({ ...found, entry: { ...found.entry, title: name } });
      emit("history", null);
      return file;
    },
    openHistory: async (id) => {
      const found = await records.get(id);
      if (!found) throw new Refusal("This transcript is no longer in the browser's history.");
      return { text: "", lines: found.lines, timestamps: found.entry.timestamps, hash: `r${found.revision}`, changed: false, audio: files.has(found.entry.audio) ? "same" : "missing" };
    },
    checkCandidate: async (id, _kind, path) => {
      const found = await records.get(id);
      const file = files.get(path);
      if (!found || !file || !found.audio_size) return "unknown";
      return file.size === found.audio_size ? "same" : "different";
    },
    relocateHistory: async (id, _kind, path) => {
      const found = await records.get(id);
      if (!found) return;
      await records.put({ ...found, entry: { ...found.entry, audio: path } });
      emit("history", null);
    },
    audioUrl: async (path) => {
      const file = files.get(path);
      if (!file) throw new Refusal("Choose the recording again: the browser forgets files when the page reloads.");
      let url = urls.get(path);
      if (!url) {
        url = URL.createObjectURL(file);
        urls.set(path, url);
      }
      return url;
    },
    confirm: async (message) => window.confirm(message),
    log: (level, message) => console[level](message),
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    appVersion: async () => __APP_VERSION__,
    diskSpace: async () => {
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      return { free: Math.max(0, (estimate?.quota ?? 0) - (estimate?.usage ?? 0)), minimum: 2 ** 30, reserve: 2 ** 30 };
    },
    measureSpeed: async () => 0,
    checkUpdate: async () => null,
    updateBlocker: async () => "The browser version updates itself when the page loads.",
    downloadUpdate: async () => {},
    installUpdate: async () => {},
    gpuInfo: async () => ({ backend: null, name: null, free_bytes: null, usable: (await unsupported()) === null, model_budget: null }),
    checkSetupDownloads: async () => {
      const refused = checkStorage(await navigator.storage?.estimate?.().catch(() => null), DOWNLOAD_BYTES);
      if (refused) throw new Refusal(refused);
      return DOWNLOAD_BYTES;
    },
    autorun: async () => null,
    pickAudioFile: async () => {
      const file = await pick();
      return file ? remember(file) : null;
    },
    pickModelFile: async () => null,
    pickTranscriptFile: async () => null,
    pickExportFile: async (name, format) => `${name}.${format}`,
    onEngineEvent: (h) => on<EngineEvent>("engine", h),
    onStats: () => Promise.resolve(() => {}),
    onDownloadProgress: (h) => on("download", h),
    onAppError: (h) => on<string>("app-error", h),
    onModelsChanged: (h) => on("models", h),
    onHistoryChanged: (h) => on("history", h),
    onDrop: async (handler) => {
      let depth = 0;
      const enter = (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        depth += 1;
        handler("over");
      };
      const over = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      };
      const leave = () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) handler("leave");
      };
      const drop = (e: DragEvent) => {
        e.preventDefault();
        depth = 0;
        const file = e.dataTransfer?.files[0];
        handler(file ? [remember(file)] : "leave");
      };
      window.addEventListener("dragenter", enter);
      window.addEventListener("dragover", over);
      window.addEventListener("dragleave", leave);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragenter", enter);
        window.removeEventListener("dragover", over);
        window.removeEventListener("dragleave", leave);
        window.removeEventListener("drop", drop);
      };
    },
  };
  return backend;
}
