// Mirrors the run loop in engine/src/main.rs for the browser. Keep the two in step.
import { AutoProcessor, Tensor, WhisperForConditionalGeneration, env, type Processor, type PreTrainedModel } from "@huggingface/transformers";
import ortFactory from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import engineWasm from "./engine.wasm?url";
import type { EngineEvent, Heard } from "../types";
import type { Line } from "../run";
import { DTYPE, MODEL_ID, ORT_WASM, REVISION } from "./model";
import { read } from "./store";

export type Request = { type: "run"; run: number; audio: Float32Array; language: string } | { type: "cancel"; run: number };

export type Reply =
  | { run: number; type: "event"; event: EngineEvent }
  | { run: number; type: "finished"; lines: Line[]; language: string; heard: Heard[]; load: number; transcribe: number }
  | { run: number; type: "log"; message: string };

const RATE = 16_000;

type Engine = {
  memory: WebAssembly.Memory;
  alloc(bytes: number): number;
  dealloc(pointer: number, bytes: number): void;
  lines(audio: number, samples: number, language: number, languageBytes: number): number;
  probe_lines(audio: number, samples: number): number;
};

let engine: Promise<Engine> | null = null;
let whisper: Promise<{ processor: Processor; model: PreTrainedModel; device: string }> | null = null;
let cancelled = -1;

const post = (reply: Reply) => self.postMessage(reply);

function loadEngine(): Promise<Engine> {
  engine ??= fetch(engineWasm)
    .then((r) => r.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then(({ instance }) => instance.exports as unknown as Engine);
  return engine;
}

async function cut(audio: Float32Array, language: string | null): Promise<[number, number][]> {
  const e = await loadEngine();
  const audioBytes = audio.length * 4;
  const audioAt = e.alloc(audioBytes);
  new Float32Array(e.memory.buffer, audioAt, audio.length).set(audio);
  const code = new TextEncoder().encode(language ?? "");
  const codeAt = e.alloc(Math.max(code.length, 1));
  new Uint8Array(e.memory.buffer, codeAt, code.length).set(code);
  const result = language === null ? e.probe_lines(audioAt, audio.length) : e.lines(audioAt, audio.length, codeAt, code.length);
  const count = new Uint32Array(e.memory.buffer, result, 1)[0];
  const bounds = new Uint32Array(e.memory.buffer, result + 4, count * 2);
  const windows = Array.from({ length: count }, (_, i): [number, number] => [bounds[i * 2], bounds[i * 2 + 1]]);
  e.dealloc(codeAt, Math.max(code.length, 1));
  e.dealloc(audioAt, audioBytes);
  return windows;
}

async function adapterName(): Promise<string> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("This browser offers no graphics chip for WebGPU, which the browser version needs.");
  return [adapter.info.vendor, adapter.info.architecture].filter(Boolean).join(" ") || "WebGPU";
}

function loadWhisper() {
  whisper ??= (async () => {
    const device = await adapterName();
    const wasm = await read(ORT_WASM.url);
    if (!wasm) throw new Error("The model is not installed.");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = false;
    env.useWasmCache = false;
    env.useCustomCache = true;
    env.customCache = { match: (key: string) => read(key), put: async () => {} };
    env.fetch = async () => new Response(null, { status: 404 });
    const onnx = env.backends.onnx;
    if (onnx.wasm) {
      // With its default thread pool, ONNX Runtime 1.31.0-dev sometimes never finishes creating a session inside a worker.
      onnx.wasm.numThreads = 1;
      onnx.wasm.wasmBinary = await wasm.arrayBuffer();
      onnx.wasm.wasmPaths = { mjs: ortFactory };
    }
    const processor = await AutoProcessor.from_pretrained(MODEL_ID, { revision: REVISION });
    const model = await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, { revision: REVISION, device: "webgpu", dtype: DTYPE });
    return { processor, model, device };
  })();
  whisper.catch(() => {
    whisper = null;
  });
  return whisper;
}

/** Whisper's language check: the probabilities of the language tokens after the start token. */
async function languageProbabilities(processor: Processor, model: PreTrainedModel, samples: Float32Array): Promise<Map<string, number>> {
  const config = model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  const inputs = await processor(samples);
  const start = new Tensor("int64", BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1]);
  const { logits } = (await model({ ...inputs, decoder_input_ids: start })) as { logits: Tensor };
  const scores = logits.data as Float32Array;
  const tokens = Object.entries(config.lang_to_id).map(([token, id]) => [token.slice(2, -2), scores[id]] as const);
  const top = Math.max(...tokens.map(([, s]) => s));
  const weights = tokens.map(([code, s]) => [code, Math.exp(s - top)] as const);
  const sum = weights.reduce((total, [, w]) => total + w, 0);
  return new Map(weights.map(([code, w]) => [code, w / sum]));
}

function rank(probes: Map<string, number>[]): Heard[] {
  if (probes.length === 0) return [];
  const codes = [...probes[0].keys()];
  return codes
    .map((code) => ({ code, probability: probes.reduce((sum, p) => sum + (p.get(code) ?? 0), 0) / probes.length }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}

// Port of repeats_itself in engine/src/transcribe.rs.
function repeatsItself(text: string): boolean {
  const chars = [...text, " "];
  for (let length = 24; length <= chars.length / 2; length++) {
    for (let start = 0; start <= chars.length - 2 * length; start++) {
      let same = true;
      for (let i = 0; i < length && same; i++) same = chars[start + i] === chars[start + length + i];
      if (same) return true;
    }
  }
  return false;
}

async function transcribe(run: number, audio: Float32Array, requested: string) {
  const emit = (event: EngineEvent) => post({ run, type: "event", event });
  emit({ event: "step", step: "load" });
  const loadStarted = performance.now();
  const { processor, model, device } = await loadWhisper();
  emit({ event: "loading", part: "device" });
  const probe = (await cut(audio, null)).slice(0, 3);
  const probes: Map<string, number>[] = [];
  for (const [start, end] of probe) {
    if (cancelled === run) return;
    emit({ event: "loading", part: "language" });
    try {
      probes.push(await languageProbabilities(processor, model, audio.subarray(start, end)));
    } catch (error) {
      if (requested === "auto") throw error;
      post({ run, type: "log", message: `could not detect the spoken language: ${String(error)}` });
      break;
    }
  }
  const heard = rank(probes);
  const language = requested === "auto" ? (heard[0]?.code ?? "en") : requested;
  const windows = await cut(audio, language);
  emit({ event: "model", device: "webgpu", device_name: device, threads: 0, language, windows: windows.length, heard });
  const load = (performance.now() - loadStarted) / 1000;

  emit({ event: "step", step: "transcribe" });
  const started = performance.now();
  const lines: Line[] = [];
  let position = 0;
  for (const [i, [start, end]] of windows.entries()) {
    if (cancelled === run) return;
    const inputs = await processor(audio.subarray(start, end));
    const ids = (await model.generate({ ...inputs, language, task: "transcribe", return_timestamps: false, do_sample: false, num_beams: 1 })) as Tensor;
    const text = (processor.batch_decode(ids, { skip_special_tokens: true }) as string[])[0].trim();
    if (repeatsItself(text)) post({ run, type: "log", message: `line ${i + 1} repeats itself` });
    const line: Line = { start: start / RATE, end: end / RATE, text };
    lines.push(line);
    emit({ event: "line", ...line });
    position = Math.max(position, line.end);
    emit({ event: "progress", done: i + 1, total: windows.length, position });
  }
  post({ run, type: "finished", lines, language, heard, load, transcribe: (performance.now() - started) / 1000 });
}

self.onmessage = (message: MessageEvent<Request>) => {
  const request = message.data;
  if (request.type === "cancel") {
    cancelled = request.run;
    return;
  }
  transcribe(request.run, request.audio, request.language).catch((error: unknown) => {
    post({ run: request.run, type: "event", event: { event: "error", message: error instanceof Error ? error.message : String(error) } });
  });
};
