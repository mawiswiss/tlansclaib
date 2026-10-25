export const RATE = 16000;

// 16-bit PCM mono 16 kHz, the format make-german.sh and the engine fixture use.
export async function loadWav(url) {
    const view = new DataView(await (await fetch(url)).arrayBuffer());
    let offset = 12;
    while (offset < view.byteLength) {
        const id = String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
        const size = view.getUint32(offset + 4, true);
        if (id === 'data') {
            const samples = new Float32Array(size / 2);
            for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
            return samples;
        }
        offset += 8 + size + (size % 2);
    }
    throw new Error(`no data chunk in ${url}`);
}

// Line bounds come from `tlansclaib-engine split`, so every runtime hears the same lines as the app.
export async function loadLines(url) {
    const text = await (await fetch(url)).text();
    return text.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => 'start' in l);
}

export function slice(samples, line) {
    return samples.subarray(Math.round(line.start * RATE), Math.round(line.end * RATE));
}

// Port of audio_ctx_for and repeats_itself in engine/src/transcribe.rs.
export function audioCtxFor(count) {
    return Math.min(Math.ceil(count / RATE) * 50 + 500, 1500);
}

export function repeatsItself(text) {
    const chars = [...text, ' '];
    for (let length = 24; length <= chars.length / 2; length++) {
        for (let start = 0; start <= chars.length - 2 * length; start++) {
            let same = true;
            for (let i = 0; i < length && same; i++) same = chars[start + i] === chars[start + length + i];
            if (same) return true;
        }
    }
    return false;
}

export const CLIPS = [
    { name: 'english', language: 'en' },
    { name: 'german', language: 'de' },
];
