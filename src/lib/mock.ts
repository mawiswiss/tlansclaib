// A stand-in backend for opening the interface in a plain browser during development.
import type { Backend } from "./ipc";
import { DETECTION_ID } from "./detection";
import type { DownloadProgress, EngineEvent, HistoryEntry, ModelStatus, SpeakerDetection, Stats } from "./types";

const THAI = "สวัสดีครับ วันนี้เราจะมาคุยกันเรื่องแผนงานของเดือนหน้า";
const EN = "The quick brown fox jumps over the lazy dog, this is a short test of the transcription engine.";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

const TURNS = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1];

function mockTranscript(timed: boolean, speakers: string[] = []): string {
  const lines = [THAI, EN, "Wir besprechen heute das Budget für das nächste Quartal.", THAI, EN, THAI, EN, THAI, EN, THAI, EN, THAI];
  return lines
    .map((text, i) => (speakers.length ? `${speakers[TURNS[i] % speakers.length]}: ${text}` : text))
    .map((text, i) => (timed ? `[00:${two(Math.floor((i * 13) / 60))}:${two((i * 13) % 60)}.00 --> 00:${two(Math.floor((i * 13 + 13) / 60))}:${two((i * 13 + 13) % 60)}.00] ${text}` : text))
    .join("\n");
}

let silent: string | null = null;

function silence(): string {
  if (silent) return silent;
  const rate = 8000;
  const samples = rate * 600;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  silent = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  return silent;
}

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
    model("thai-best", "Thai (best quality)", ["th"], "Thai recordings when time does not matter", 1656538283, 2.4, "https://example.invalid", "large-v3", "q8_0", false),
    model("german-fast", "German (fast)", ["de"], "German recordings, more accurate than the stock large model", 574041195, 0.9, "https://example.invalid", "large-v3-turbo", "q5_0", false, false),
    { ...model("swiss-german", "Swiss German", ["de"], "Swiss German speech written as Standard German", 874188075, 1.3, "https://example.invalid", "large-v3-turbo", "q8_0", false, false), language_name: "Swiss German" },
    model("english-fast", "English (fast)", ["en"], "English meetings, as accurate as the large model and faster", 1519521155, 2.1, "https://example.invalid", "large-v3-distil-2", "f16", false, false),
    model("large-v3-turbo-q5_0", "All languages (fast)", ["all"], "Most recordings in English and other languages", 574041195, 0.9, "https://example.invalid", "large-v3-turbo", "q5_0", true),
    model("large-v3", "All languages (best quality, full precision)", ["all"], "The largest model, for a fast computer", 3095033483, 4.0, "https://example.invalid", "large-v3", "f16", false, false),
    model("tiny", "All languages (smallest)", ["all"], "Testing only", 77691713, 0.4, "https://example.invalid", "tiny", "f16", false, false),
  ];
  const titles: Record<string, string> = {
    "thai-fast": "Fast", "thai-best": "Best quality", "german-fast": "Fast", "swiss-german": "Fast", "english-fast": "Fast",
    "large-v3-turbo-q5_0": "Fast", "large-v3": "Best quality, full precision", tiny: "Smallest",
  };
  for (const m of models) m.title = titles[m.id] ?? null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;
  let lastRun: Parameters<Backend["startRun"]> | null = null;
  const heard = [
    { code: "th", probability: 0.93 },
    { code: "en", probability: 0.04 },
    { code: "lo", probability: 0.01 },
  ];
  const detection: SpeakerDetection = { available: true, installed: false, downloading: false, download_bytes: 38_113_781, disk_bytes: 0 };
  let detectionTimer: ReturnType<typeof setInterval> | null = null;
  let history: HistoryEntry[] = [
    {
      id: 1, audio: "/Users/someone/Recordings/team call.m4a", file: "/Users/someone/Recordings/team call_transcript.txt",
      model: "Thai (fast)", language: "th", audio_seconds: 6427, lines: 494, elapsed: 296, finished_at: 1760351400,
      status: "done", timestamps: true, exists: true, audio_exists: true,
    },
    {
      id: 3, audio: "/Users/someone/Recordings/client call.mp4", file: "/Users/someone/Recordings/client call_transcript.txt",
      model: "All languages (fast)", language: "en", audio_seconds: 1533, lines: 182, elapsed: 73, finished_at: 1760348000,
      status: "done", timestamps: true, speakers: ["Speaker 1", "Speaker 2"], video: true, exists: true, audio_exists: true,
    },
    {
      id: 4, audio: "/Users/someone/Recordings/design review.m4a", file: "/Users/someone/Recordings/design review_transcript.txt",
      model: "Thai (fast)", model_id: "thai-fast", language: "th", audio_seconds: 2410, lines: 188, elapsed: 120, finished_at: 1760300000,
      status: "done", timestamps: true, exists: false, audio_exists: true,
    },
    {
      id: 2, audio: "/Users/someone/Downloads/interview.mp3", file: "/Users/someone/Transcripts/interview_transcript.txt",
      model: "All languages (fast)", language: "en", audio_seconds: 1520, lines: 61, elapsed: 75, finished_at: 1760265000,
      status: "incomplete", timestamps: false, exists: false, audio_exists: false,
    },
    ...["board meeting", "customer call", "site visit", "weekly sync", "supplier interview", "training session", "budget review", "kick-off", "workshop day 1", "workshop day 2", "handover", "retro"].map(
      (name, i): HistoryEntry => ({
        id: 10 + i, audio: `/Users/someone/Recordings/${name}.m4a`, file: `/Users/someone/Recordings/${name}_transcript.txt`,
        model: i % 3 ? "Thai (fast)" : "All languages (fast)", language: i % 3 ? "th" : "en", audio_seconds: 900 + i * 410,
        lines: 40 + i * 9, elapsed: 60 + i * 20, finished_at: 1760000000 - i * 86400 * 3, status: "done", timestamps: name !== "budget review", exists: true, audio_exists: true,
      }),
    ),
  ];
  const stress = new URLSearchParams(location.search).has("stress");
  const updateMode = new URLSearchParams(location.search).get("update");
  setInterval(() => {
    const used = stress ? 13.6 : 9.7;
    const stats: Stats = {
      cpu: timer ? 86 + Math.random() * 10 : 12 + Math.random() * 30,
      memory_total: 16 * 2 ** 30,
      memory_used: used * 2 ** 30,
      memory_free: (16 - used) * 2 ** 30,
      swap_total: 2 ** 30,
      swap_used: 0.1 * 2 ** 20,
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
    speakerDetection: async () => ({ ...detection }),
    downloadSpeakerDetection: () =>
      new Promise((resolve) => {
        let bytes = 0;
        const total = detection.download_bytes;
        detection.downloading = true;
        detectionTimer = setInterval(() => {
          bytes = Math.min(total, bytes + total / 15);
          emit("download", { id: DETECTION_ID, bytes, total } satisfies DownloadProgress);
          if (bytes >= total) {
            clearInterval(detectionTimer!);
            detectionTimer = null;
            Object.assign(detection, { installed: true, downloading: false, disk_bytes: 61_904_384 });
            emit("models", null);
            resolve();
          }
        }, 250);
      }),
    cancelSpeakerDetection: async () => {
      if (detectionTimer) clearInterval(detectionTimer);
      detectionTimer = null;
      detection.downloading = false;
      emit("models", null);
    },
    removeSpeakerDetection: async () => {
      Object.assign(detection, { installed: false, disk_bytes: 0 });
      emit("models", null);
    },
    addModelFile: async (id, path) => {
      if (path.endsWith(".safetensors")) throw new Error("This file is a safetensors file (PyTorch weights), not a whisper.cpp model. A model is a whisper.cpp file, usually named ggml-….bin. PyTorch, CTranslate2 and ONNX files from Hugging Face do not work here.");
      if (id === null) {
        const name = path.split("/").pop()!.replace(/\.bin$/, "").replace(/^ggml-/, "");
        const linked: ModelStatus = {
          ...model(`linked:${name}`, name, ["all"], "", 874188075, 1.3, null, "large-v3-turbo", "q8_0", true, false),
          file: path, path, custom: true, linked: true, source: null, license: null,
        };
        models.push(linked);
        emit("models", null);
        return linked;
      }
      const m = models.find((x) => x.id === id) ?? models[0];
      m.installed = true;
      m.path = path;
      m.label = `${m.architecture}, ${m.quantization}`;
      emit("models", null);
      return m;
    },
    unlinkModel: async (id) => {
      models.splice(models.findIndex((x) => x.id === id), 1);
      emit("models", null);
    },
    renameModel: async (id, name) => {
      models.find((x) => x.id === id)!.name = name;
      emit("models", null);
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
    startRun: async (audio, modelId, language, timestamps, speakers, speakerPrecision, outputFile) => {
      lastRun = [audio, modelId, language, timestamps, speakers, speakerPrecision, outputFile];
      const run = ++generation;
      const name = audio.split("/").pop()!.replace(/\.[^.]+$/, "");
      const file = `/AppData/transcripts/${Date.now()}.json`;
      const send = (event: EngineEvent) => {
        if (run === generation) emit("engine", event);
      };
      const total = 40;
      let done = 0;
      const voices = speakers ? ["Speaker 1", "Speaker 2", "Speaker 3"] : [];
      const lag = speakers ? 2500 : 0;
      send({ event: "step", step: "decode" });
      setTimeout(() => send({ event: "audio", seconds: total * 12.9, video: audio.endsWith(".mp4") }), 600);
      if (speakers) {
        setTimeout(() => send({ event: "step", step: "speakers" }), 700);
        for (let i = 1; i <= 10; i++) setTimeout(() => send({ event: "speaker_progress", done: i, total: 10 }), 700 + i * 230);
      }
      setTimeout(() => send({ event: "step", step: "load" }), 700 + lag);
      setTimeout(() => {
        send({ event: "model", device: "metal", threads: 9, language: language === "auto" ? "th" : language, windows: total, heard });
        if (speakers) send({ event: "speakers", speakers: voices });
        send({ event: "step", step: "transcribe" });
        timer = setInterval(() => {
          done += 1;
          const start = (done - 1) * 12.9;
          send({
            event: "line",
            start,
            end: start + 12.9,
            text: done % 5 === 0 ? "" : language === "en" ? EN : THAI,
            speaker: voices.length ? TURNS[done % TURNS.length] + (done % 7 === 0 ? 1 : 0) : undefined,
          });
          send({ event: "progress", done, total, position: start + 12.9 });
          if (done >= total) {
            clearInterval(timer!);
            timer = null;
            send({ event: "step", step: "write" });
            history = [
              {
                id: Date.now(), audio, file, title: name, model: models.find((x) => x.id === modelId)?.name ?? modelId,
                language: language === "auto" ? "th" : language, audio_seconds: total * 12.9, lines: total - 8, elapsed: 9.4,
                finished_at: Math.floor(Date.now() / 1000), status: "done", timestamps, speakers: voices, detected: voices.length > 0,
                model_id: modelId, speaker_mode: speakers, speaker_precision: speakers ? speakerPrecision : null, heard, exists: true, audio_exists: true,
              },
              ...history.filter((h) => h.file !== outputFile),
            ];
            emit("history", null);
            send({ event: "done", lines: total - 8, elapsed: 9.4, file });
          }
        }, 400);
      }, 2200 + lag);
    },
    cancelRun: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      generation += 1;
      emit("engine", { event: "cancelled" } satisfies EngineEvent);
    },
    async restartRun(language) {
      if (timer) clearInterval(timer);
      timer = null;
      generation += 1;
      emit("engine", { event: "restart", language } satisfies EngineEvent);
      if (!lastRun) return;
      const [audio, modelId, , timestamps, speakers, precision, outputFile] = lastRun;
      await this.startRun(audio, modelId, language, timestamps, speakers, precision, outputFile);
    },
    listHistory: async () => history.map((h) => ({ ...h })),
    removeHistory: async (id) => {
      history = history.filter((h) => h.id !== id);
      emit("history", null);
    },
    setTranscriptTimestamps: async (file, _lines, timestamps, _speakers) => {
      history = history.map((h) => (h.file === file ? { ...h, timestamps } : h));
      emit("history", null);
      return `mock-${Date.now()}`;
    },
    saveTranscript: async (file, expected, _lines, _timestamps, speakers) => {
      if (expected === "stale") throw new Error("This transcript was changed outside tlansclaib since it was opened, so the edit was not saved.");
      if (speakers.some((s) => s.includes(":"))) throw new Error("A speaker name cannot contain a colon, because the colon ends the name in the transcript.");
      const taken = speakers.find((s, i) => speakers.slice(0, i).some((o) => o.toLowerCase() === s.toLowerCase()));
      if (taken) throw new Error(`Two speakers cannot both be called ${taken}.`);
      history = history.map((h) => (h.file === file ? { ...h, speakers } : h));
      emit("history", null);
      return `mock-${Date.now()}`;
    },
    transcriptHash: async () => "mock-initial",
    exportTranscript: async () => {},
    renameTranscript: async (file, title) => {
      const name = title.trim();
      if (!name) throw new Error("The title cannot be empty.");
      if (/[<>:"/\\|?*]/.test(name)) throw new Error("The title cannot contain that character, because file names cannot.");
      if (name === "taken") throw new Error("taken_transcript.txt already exists in this folder.");
      if (file.endsWith(".json")) {
        history = history.map((h) => (h.file === file ? { ...h, title: name } : h));
        emit("history", null);
        return file;
      }
      const target = `${file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1)}${name}_transcript.txt`;
      history = history.map((h) => (h.file === file ? { ...h, file: target } : h));
      emit("history", null);
      return target;
    },
    openHistory: async (id) => {
      const entry = history.find((h) => h.id === id)!;
      return {
        text: mockTranscript(entry.timestamps, entry.speakers),
        lines: entry.file.endsWith(".json") ? Array.from({ length: 12 }, (_, i) => ({ start: i * 13, end: i * 13 + 13, text: i % 2 ? EN : THAI, speaker: entry.speakers?.length ? TURNS[i] % entry.speakers.length : undefined })) : null,
        timestamps: entry.timestamps,
        hash: "mock-opened",
        times: entry.timestamps ? null : Array.from({ length: 12 }, (_, i): [number, number] => [i * 13, i * 13 + 13]),
        changed: id === 12,
        audio: !entry.audio_exists ? "missing" : id === 11 ? "different" : "same",
      };
    },
    checkCandidate: async (_id, _kind, path) => (path.includes("other") ? "different" : "same"),
    relocateHistory: async (id, kind, path) => {
      history = history.map((h) =>
        h.id !== id ? h : kind === "audio" ? { ...h, audio: path, audio_exists: true } : { ...h, file: path, exists: true },
      );
      emit("history", null);
    },
    audioUrl: async () => silence(),
    confirm: async (message) => window.confirm(message),
    log: (level, message) => console[level](message),
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    appVersion: async () => "0.1.0",
    diskSpace: async () => ({ free: (stress ? 10.8 : 214) * 2 ** 30, minimum: 2 ** 30, reserve: 10 * 2 ** 30 }),
    measureSpeed: () => new Promise((resolve) => setTimeout(() => resolve(4.6e6), 1200)),
    checkUpdate: () =>
      new Promise((resolve, reject) =>
        setTimeout(() => {
          if (updateMode === "fail") reject(new Error("could not reach GitHub"));
          else resolve(updateMode === null ? null : "0.2.0");
        }, 800),
      ),
    updateBlocker: async () => (updateMode === "blocked" ? "Move tlansclaib to the Applications folder and start it from there, then update." : null),
    downloadUpdate: (onProgress) =>
      new Promise((resolve) => {
        const total = 48_000_000;
        let received = 0;
        const timer = setInterval(() => {
          received = Math.min(total, received + 2_400_000);
          onProgress(received, total);
          if (received === total) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      }),
    installUpdate: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          location.reload();
          resolve();
        }, 1200),
      ),
    autorun: async () => null,
    pickAudioFile: async () => "/Users/someone/Recordings/meeting.m4a",
    pickModelFile: async () => "/Volumes/USB/ggml-thai-fast-q8_0.bin",
    pickTranscriptFile: async () => "/Users/someone/Archive/interview_transcript.txt",
    pickExportFile: async (name) => `/Users/someone/Documents/${name}.txt`,
    onEngineEvent: (h) => on<EngineEvent>("engine", h),
    onStats: (h) => on<Stats>("stats", h),
    onDownloadProgress: (h) => on<DownloadProgress>("download", h),
    onAppError: (h) => on<string>("app-error", h),
    onModelsChanged: (h) => on("models", h),
    onHistoryChanged: (h) => on("history", h),
    onDrop: async () => () => {},
  };
}

function model(id: string, name: string, languages: string[], recommended: string, size: number, ram: number, url: string | null, architecture: string, quantization: string, installed: boolean, featured = true): ModelStatus {
  return {
    id, name, languages, language_name: null, recommended, featured, file: `ggml-${id}.bin`, size_bytes: size, sha256: null, ram_gb: ram, url,
    architecture, quantization, source: "https://huggingface.co/ggerganov/whisper.cpp", license: "MIT",
    installed, path: installed ? `/models/ggml-${id}.bin` : null, label: installed ? `${architecture}, ${quantization}` : null, custom: false, linked: false,
  };
}
