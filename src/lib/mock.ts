// A stand-in backend for opening the interface in a plain browser during development.
import type { Backend } from "./ipc";
import type { DownloadProgress, EngineEvent, ModelStatus, Stats } from "./types";

const THAI = "สวัสดีครับ วันนี้เราจะมาคุยกันเรื่องแผนงานของเดือนหน้า";
const EN = "The quick brown fox jumps over the lazy dog, this is a short test of the transcription engine.";

export function mockBackend(): Backend {
  const target = new EventTarget();
  const emit = (name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
  const on = <T,>(name: string, handler: (detail: T) => void) => {
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
    target.addEventListener(name, listener);
    return Promise.resolve(() => target.removeEventListener(name, listener));
  };
  const models: ModelStatus[] = [
    model("thai-fast", "Thai (fast)", ["th"], "Thai recordings on any computer", 874188075, 1.3, null, "large-v3-turbo", "q8_0", true),
    model("thai-best", "Thai (best quality)", ["th"], "Thai recordings when time does not matter", 1656538283, 2.4, null, "large-v3", "q8_0", false),
    model("large-v3-turbo-q5_0", "All languages (fast)", ["all"], "Most recordings in English and other languages", 574041195, 0.9, "https://example.invalid", "large-v3-turbo", "q5_0", true),
    model("large-v3", "All languages (best quality, full precision)", ["all"], "The largest model, for a fast computer", 3095033483, 4.0, "https://example.invalid", "large-v3", "f16", false),
    model("tiny", "All languages (smallest)", ["all"], "Testing only", 77691713, 0.4, "https://example.invalid", "tiny", "f16", false),
  ];
  let timer: ReturnType<typeof setInterval> | null = null;
  setInterval(() => {
    const stats: Stats = {
      cpu: 12 + Math.random() * 30,
      memory_total: 16 * 2 ** 30,
      memory_used: 9.2 * 2 ** 30,
      memory_free: 6.3 * 2 ** 30,
      swap_total: 2 ** 30,
      swap_used: 120 * 2 ** 20,
      app_memory: 180 * 2 ** 20,
      engine_memory: timer ? 1.4 * 2 ** 30 : 0,
    };
    emit("stats", stats);
  }, 1000);
  return {
    listModels: async () => models.map((m) => ({ ...m })),
    modelsFolder: async () => "/Users/someone/Library/Application Support/tlansclaib/models",
    downloadModel: (id) =>
      new Promise((resolve) => {
        const m = models.find((x) => x.id === id)!;
        let bytes = 0;
        const step = setInterval(() => {
          bytes = Math.min(m.size_bytes, bytes + m.size_bytes / 20);
          emit("download", { id, bytes, total: m.size_bytes } satisfies DownloadProgress);
          if (bytes >= m.size_bytes) {
            clearInterval(step);
            m.installed = true;
            m.path = `/models/${m.file}`;
            m.label = `${m.architecture}, ${m.quantization}`;
            emit("models", null);
            resolve();
          }
        }, 300);
      }),
    cancelDownload: async () => {},
    addModelFile: async (id, path) => {
      if (path.endsWith(".safetensors")) throw new Error("This file is a safetensors file (PyTorch weights), not a whisper.cpp model. A model is a whisper.cpp file, usually named ggml-….bin. PyTorch, CTranslate2 and ONNX files from Hugging Face do not work here.");
      const m = models.find((x) => x.id === id) ?? models[0];
      m.installed = true;
      m.path = path;
      m.label = `${m.architecture}, ${m.quantization}`;
      emit("models", null);
      return m;
    },
    deleteModel: async (id) => {
      const m = models.find((x) => x.id === id)!;
      m.installed = false;
      m.path = null;
      emit("models", null);
    },
    reveal: async () => {},
    listLanguages: async () => [
      { code: "en", name: "english" },
      { code: "th", name: "thai" },
      { code: "de", name: "german" },
      { code: "fr", name: "french" },
      { code: "ja", name: "japanese" },
    ],
    startRun: async (audio, _modelId, language) => {
      const send = (event: EngineEvent) => emit("engine", event);
      const total = 14;
      let done = 0;
      send({ event: "step", step: "decode" });
      setTimeout(() => send({ event: "audio", seconds: 180.05 }), 600);
      setTimeout(() => send({ event: "step", step: "load" }), 700);
      setTimeout(() => {
        send({ event: "model", device: "metal", threads: 9, language: language === "auto" ? "th" : language, windows: total });
        send({ event: "step", step: "transcribe" });
        timer = setInterval(() => {
          done += 1;
          const start = (done - 1) * 12.9;
          send({ event: "line", start, end: start + 12.9, text: done % 5 === 0 ? "" : language === "en" ? EN : THAI });
          send({ event: "progress", done, total, position: start + 12.9 });
          if (done >= total) {
            clearInterval(timer!);
            timer = null;
            send({ event: "step", step: "write" });
            send({ event: "done", lines: total - 2, elapsed: 9.4, txt: audio.replace(/\.[^.]+$/, "_transcript.txt"), timestamps: audio.replace(/\.[^.]+$/, "_transcript_timestamps.txt") });
          }
        }, 500);
      }, 2200);
    },
    cancelRun: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      emit("engine", { event: "cancelled" } satisfies EngineEvent);
    },
    readTextFile: async () => Array(12).fill(THAI).join("\n"),
    autorun: async () => null,
    pickAudioFile: async () => "/Users/someone/Recordings/meeting.m4a",
    pickModelFile: async () => "/Volumes/USB/ggml-thai-fast-q8_0.bin",
    pickFolder: async () => "/Users/someone/Documents",
    onEngineEvent: (h) => on<EngineEvent>("engine", h),
    onStats: (h) => on<Stats>("stats", h),
    onDownloadProgress: (h) => on<DownloadProgress>("download", h),
    onModelsChanged: (h) => on("models", h),
    onDrop: async () => () => {},
  };
}

function model(id: string, name: string, languages: string[], recommended: string, size: number, ram: number, url: string | null, architecture: string, quantization: string, installed: boolean): ModelStatus {
  return {
    id, name, languages, recommended, file: `ggml-${id}.bin`, size_bytes: size, sha256: null, ram_gb: ram, url,
    architecture, quantization, source: "https://huggingface.co/ggerganov/whisper.cpp", license: "MIT",
    installed, path: installed ? `/models/ggml-${id}.bin` : null, label: installed ? `${architecture}, ${quantization}` : null, custom: false,
  };
}
