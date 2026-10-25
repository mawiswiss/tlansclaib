import createModule from '/build/whisper.mjs';
import { CLIPS, RATE, audioCtxFor, loadLines, loadWav, repeatsItself, slice } from './common.js';

onmessage = async ({ data: { model, threads, runs } }) => {
    const started = performance.now();
    const module = await createModule();
    const bytes = new Uint8Array(await (await fetch(`/models/${model}`)).arrayBuffer());
    const fetched = performance.now();
    module.FS.writeFile('/model.bin', bytes);
    if (!module.cwrap('spike_load', 'number', ['string'])('/model.bin')) {
        throw new Error('whisper_init failed');
    }
    module.FS.unlink('/model.bin');
    const load = { fetch_ms: fetched - started, total_ms: performance.now() - started };

    const decode = module.cwrap('spike_decode', 'string', ['number', 'number', 'string', 'number', 'number']);
    const transcribe = (samples, language) => {
        const pointer = module._malloc(samples.length * 4);
        module.HEAPF32.set(samples, pointer / 4);
        const pass = (audioCtx) => ({
            audio_ctx: audioCtx,
            text: decode(pointer, samples.length, language, audioCtx, threads),
            tokens: module._spike_tokens(),
            encode_ms: module._spike_encode_ms(),
            decode_ms: module._spike_decode_ms(),
        });
        try {
            if (samples.length < RATE) return { text: '', passes: [] };
            const audioCtx = audioCtxFor(samples.length);
            const first = pass(audioCtx === 1500 ? 0 : audioCtx);
            if (audioCtx === 1500 || !repeatsItself(first.text)) return { text: first.text, passes: [first] };
            const full = pass(0);
            return { text: full.text, passes: [first, full] };
        } finally {
            module._free(pointer);
        }
    };

    const results = [];
    for (const clip of CLIPS) {
        const samples = await loadWav(`/audio/${clip.name}.wav`);
        const lines = await loadLines(`/audio/${clip.name}.lines.json`);
        for (let run = 1; run <= runs; run++) {
            const t0 = performance.now();
            const out = lines.map((line) => ({ start: line.start, end: line.end, ...transcribe(slice(samples, line), clip.language) }));
            results.push({ clip: clip.name, run, audio_s: samples.length / RATE, ms: performance.now() - t0, lines: out });
        }
    }
    postMessage({ runtime: 'whisper.cpp wasm', model, threads, load, results });
};

