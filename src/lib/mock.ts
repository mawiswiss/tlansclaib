// A stand-in backend for opening the interface in a plain browser during development.
import type { Backend } from "./ipc";
import { DETECTION_IDS } from "./setup";
import type { DownloadProgress, EngineEvent, HistoryEntry, ModelStatus, SpeakerBackend, SpeakerDetection, Stats } from "./types";

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

function spread(text: string, start: number, end: number) {
  const words = text.split(" ");
  const step = (end - start) / words.length;
  return words.map((word, i) => ({ start: start + i * step, end: start + (i + 1) * step, text: word }));
}

export function mockBackend(): Backend {
  const target = new EventTarget();
  const emit = (name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
  const on = <T,>(name: string, handler: (detail: T) => void) => {
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
    target.addEventListener(name, listener);
    return Promise.resolve(() => target.removeEventListener(name, listener));
  };
  const query = new URLSearchParams(location.search);
  const fresh = query.has("fresh");
  const heavy = query.has("heavy") ? "Memory ran low while it transcribed." : null;
  const lowRam = query.has("lowram") ? Number(query.get("lowram") || 2) * 2 ** 30 : null;
  const midStop = query.has("midstop");
  const models: ModelStatus[] = [
    { ...model("thai-fast", "Thai Compact", ["th"], ["essential"], "Thai recordings on any computer. Smaller than Thai Best, with a few more mistakes.", 874188075, 1.3, "large-v3-turbo", "q8_0", !fresh), too_heavy: heavy },
    model("thai-best", "Thai Best", ["th"], ["precise"], "The most accurate for Thai, when time does not matter.", 1656538283, 2.4, "large-v3", "q8_0", false),
    model("german-full", "German", ["de"], ["essential", "precise"], "German recordings, more accurate than the stock large model", 1624555275, 2.2, "large-v3-turbo", "f16", false),
    { ...model("swiss-german", "Swiss German", ["de"], ["essential", "precise"], "Swiss German speech, written as Standard German", 874188075, 1.3, "large-v3-turbo", "q8_0", false), language_name: "Swiss German" },
    model("english-fast", "English", ["en"], ["precise"], "English meetings, as accurate as the large model and faster", 1519521155, 2.1, "large-v3-distil-2", "f16", false),
    model("french-q8_0", "French Compact", ["fr"], ["essential"], "French recordings. Half the size of French Best and nearly as accurate.", 1656538283, 2.4, "large-v3", "q8_0", false),
    model("large-v3-turbo-q8_0", "Universal Compact", ["all"], ["essential"], "Most recordings in English and other languages.", 874188075, 1.3, "large-v3-turbo", "q8_0", !fresh),
    model("large-v3", "Universal Best", ["all"], ["precise"], "The largest and most accurate model for all languages, for a fast computer with plenty of memory.", 3095033483, 4.0, "large-v3", "f16", false),
    model("small-q8_0", "Universal Small", ["all"], ["minimal"], "Weak computers and clear audio, noticeably more mistakes.", 264464607, 0.7, "small", "q8_0", false),
  ];
  const ranks: Record<string, number> = {
    "thai-fast": 1, "thai-best": 2, "german-full": 2, "swiss-german": 1, "english-fast": 1, "french-q8_0": 2,
    "large-v3-turbo-q8_0": 3, "large-v3": 6, "small-q8_0": 1,
  };
  for (const m of models) m.quality = ranks[m.id] ?? null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;
  let lastRun: Parameters<Backend["startRun"]> | null = null;
  const heard = [
    { code: "th", probability: 0.93 },
    { code: "en", probability: 0.04 },
    { code: "lo", probability: 0.01 },
  ];
  const detections: SpeakerDetection[] = [
    { backend: "sherpa", available: true, installed: query.has("speakers"), downloading: false, download_bytes: 38_113_781, disk_bytes: 0 },
    { backend: "nemotron", available: true, installed: query.has("nemotron") || query.has("broken") || query.has("intact"), downloading: false, download_bytes: 202_061_718, disk_bytes: 0 },
  ];
  const BROKEN = "speaker detection could not start on this computer: LoadLibraryExW failed: The specified module could not be found. (os error 126)";
  if (query.has("broken") || query.has("intact")) Object.assign(detections[1], { broken: BROKEN, damaged: query.has("broken") });
  const detectionTimers: Partial<Record<SpeakerBackend, ReturnType<typeof setInterval>>> = {};
  const downloadTimers: Record<string, ReturnType<typeof setInterval>> = {};
  const cancels: Record<string, () => void> = {};
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
  const stress = query.has("stress");
  const updateMode = query.get("update");
  setInterval(() => {
    const used = stress ? 13.6 : 9.7;
    const stats: Stats = {
      cpu: timer ? 86 + Math.random() * 10 : 12 + Math.random() * 30,
      memory_total: 16 * 2 ** 30,
      memory_used: used * 2 ** 30,
      memory_free: (16 - used) * 2 ** 30,
      model_budget: (15 - used) * 2 ** 30,
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
        downloadTimers[id] = setInterval(() => {
          bytes = Math.min(m.size_bytes, bytes + m.size_bytes / 20);
          emit("download", { id, bytes, total: m.size_bytes } satisfies DownloadProgress);
          if (bytes >= m.size_bytes) {
            clearInterval(downloadTimers[id]);
            delete downloadTimers[id];
            m.installed = true;
            m.path = `/models/${m.file}`;
            m.label = `${m.architecture}, ${m.quantization}`;
            emit("models", null);
            resolve();
          }
        }, 300);
        cancels[id] = () => {
          clearInterval(downloadTimers[id]);
          delete downloadTimers[id];
          resolve();
        };
      }),
    cancelDownload: async (id) => {
      cancels[id]?.();
      delete cancels[id];
    },
    speakerDetection: async () => detections.map((d) => ({ ...d })),
    downloadSpeakerDetection: (backend) =>
      new Promise((resolve) => {
        const detection = detections.find((d) => d.backend === backend)!;
        let bytes = 0;
        const total = detection.download_bytes;
        detection.downloading = true;
        detectionTimers[backend] = setInterval(() => {
          bytes = Math.min(total, bytes + total / 15);
          emit("download", { id: DETECTION_IDS[backend], bytes, total } satisfies DownloadProgress);
          if (bytes >= total) {
            clearInterval(detectionTimers[backend]);
            delete detectionTimers[backend];
            Object.assign(detection, { installed: true, downloading: false, broken: null, damaged: false, disk_bytes: backend === "sherpa" ? 61_904_384 : 203_000_000 });
            emit("models", null);
            resolve();
          }
        }, 250);
        cancels[DETECTION_IDS[backend]] = resolve;
      }),
    cancelSpeakerDetection: async (backend) => {
      clearInterval(detectionTimers[backend]);
      delete detectionTimers[backend];
      detections.find((d) => d.backend === backend)!.downloading = false;
      cancels[DETECTION_IDS[backend]]?.();
      emit("models", null);
    },
    removeSpeakerDetection: async (backend) => {
      Object.assign(detections.find((d) => d.backend === backend)!, { installed: false, broken: null, damaged: false, disk_bytes: 0 });
      emit("models", null);
    },
    addModelFile: async (id, path) => {
      if (path.endsWith(".safetensors")) throw new Error("This file is a safetensors file (PyTorch weights), not a whisper.cpp model. A model is a whisper.cpp file, usually named ggml-….bin. PyTorch, CTranslate2 and ONNX files from Hugging Face do not work here.");
      if (id === null) {
        const name = path.split("/").pop()!.replace(/\.bin$/, "").replace(/^ggml-/, "");
        const linked: ModelStatus = {
          ...model(`linked:${name}`, name, ["all"], null, "", 874188075, 1.3, "large-v3-turbo", "q8_0", true),
          file: path, path, url: null, custom: true, linked: true, source: null, license: null,
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
    startRun: async (audio, modelId, language, timestamps, speakers, speakerPrecision, speakerBackend, outputFile, force) => {
      const chosen = models.find((x) => x.id === modelId)!;
      if (lowRam !== null && !force) {
        const detection = speakers ? 1.5 * 2 ** 30 : 0;
        const budget = (free: number, reserve: number) => (free - 2 ** 30 >= reserve ? free - 2 ** 30 : null);
        if (Math.max(chosen.ram_gb * 2 ** 30, detection) + 2 ** 30 > lowRam) {
          throw {
            kind: "memory",
            message: `This transcription needs about ${(Math.max(chosen.ram_gb, detection / 2 ** 30) + 1).toFixed(1)} GB of free memory and ${(lowRam / 2 ** 30).toFixed(1)} GB is free. Close other programs, choose a smaller model, or use a shorter recording.`,
            free: lowRam,
            budget: budget(lowRam, detection),
            budget_without_speakers: speakers ? budget(lowRam, 0) : null,
          };
        }
      }
      lastRun = [audio, modelId, language, timestamps, speakers, speakerPrecision, speakerBackend, outputFile, force];
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
      if (speakers && query.has("speakerfail")) {
        setTimeout(() => send({ event: "step", step: "speakers" }), 700);
        setTimeout(() => send({ event: "error", message: BROKEN }), 1500);
        return;
      }
      if (speakers) {
        setTimeout(() => send({ event: "step", step: "speakers" }), 700);
        for (let i = 1; i <= 10; i++) setTimeout(() => send({ event: "speaker_progress", done: i, total: 10 }), 700 + i * 230);
      }
      setTimeout(() => send({ event: "step", step: "load" }), 700 + lag);
      setTimeout(() => send({ event: "loading", part: "device" }), 1300 + lag);
      setTimeout(() => send({ event: "loading", part: "language" }), 1700 + lag);
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
          if (midStop && done === 10) {
            clearInterval(timer!);
            timer = null;
            chosen.too_heavy = "Memory ran low while it transcribed.";
            emit("models", null);
            send({ event: "too_heavy", model_id: modelId });
            send({ event: "error", message: "Stopped before the computer ran out of memory: only 0.3 GB was left. Close other programs or choose a smaller model. Automatic skips this model from now on. You can still pick it in the Model menu." });
            return;
          }
          if (done >= total) {
            clearInterval(timer!);
            timer = null;
            send({ event: "step", step: "write" });
            history = [
              {
                id: Date.now(), audio, file, title: name, model: models.find((x) => x.id === modelId)?.name ?? modelId,
                language: language === "auto" ? "th" : language, audio_seconds: total * 12.9, lines: total - 8, elapsed: 9.4,
                finished_at: Math.floor(Date.now() / 1000), status: "done", timestamps, speakers: voices, detected: voices.length > 0, edited: false,
                model_id: modelId, speaker_mode: speakers, speaker_precision: speakers ? speakerPrecision : null, speaker_backend: speakers ? speakerBackend : null, heard, exists: true, audio_exists: true,
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
      const [audio, modelId, , timestamps, speakers, precision, backend, outputFile, force] = lastRun;
      await this.startRun(audio, modelId, language, timestamps, speakers, precision, backend, outputFile, force);
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
      history = history.map((h) => (h.file === file ? { ...h, speakers, edited: true } : h));
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
        lines: entry.file.endsWith(".json") ? Array.from({ length: 12 }, (_, i) => ({ start: i * 13, end: i * 13 + 13, text: i % 2 ? EN : THAI, speaker: entry.speakers?.length ? TURNS[i] % entry.speakers.length : undefined, words: i % 2 ? spread(EN, i * 13, i * 13 + 13) : undefined })) : null,
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
    measureSpeed: () =>
      new Promise((resolve, reject) =>
        setTimeout(() => (query.has("offline") ? reject(new Error("no connection to the model server")) : resolve(query.has("slow") ? 1.2e6 : 42e6)), 1200),
      ),
    gpuInfo: async () =>
      query.has("nogpu") ? { backend: null, name: null, free_bytes: null, usable: false, model_budget: null } : { backend: "metal", name: "Apple M5", free_bytes: null, usable: true, model_budget: null },
    checkSetupDownloads: async (modelIds, backend) => {
      const missingModels = models.filter((m) => modelIds.includes(m.id) && !m.installed).reduce((sum, m) => sum + m.size_bytes, 0);
      const detection = detections.find((d) => d.backend === backend && !d.installed);
      const total = missingModels + (detection ? detection.download_bytes * 2 : 0);
      const free = (stress ? 10.8 : 214) * 2 ** 30;
      if (free < total + 2 ** 30) throw new Error(`Not enough disk space: the models need ${(total / 2 ** 30).toFixed(1)} GB plus 1.0 GB to spare, and ${(free / 2 ** 30).toFixed(1)} GB is free. Make room on the disk first.`);
      return total;
    },
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
    pickExportFile: async (name, format) => `/Users/someone/Documents/${name}.${format}`,
    onEngineEvent: (h) => on<EngineEvent>("engine", h),
    onStats: (h) => on<Stats>("stats", h),
    onDownloadProgress: (h) => on<DownloadProgress>("download", h),
    onAppError: (h) => on<string>("app-error", h),
    onModelsChanged: (h) => on("models", h),
    onHistoryChanged: (h) => on("history", h),
    onDrop: async () => () => {},
  };
}

function model(id: string, name: string, languages: string[], setups: string[] | null, recommended: string, size: number, ram: number, architecture: string, quantization: string, installed: boolean): ModelStatus {
  return {
    id, name, languages, language_name: null, setups, recommended, file: `ggml-${id}.bin`, size_bytes: size, sha256: null, ram_gb: ram, url: "https://example.invalid",
    architecture, quantization, source: "https://huggingface.co/ggerganov/whisper.cpp", license: "MIT",
    installed, path: installed ? `/models/ggml-${id}.bin` : null, label: installed ? `${architecture}, ${quantization}` : null, custom: false, linked: false, too_heavy: null,
  };
}
