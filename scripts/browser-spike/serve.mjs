// Static server with the headers SharedArrayBuffer needs (cross-origin isolation).
// usage: node serve.mjs PORT MODELS_DIR AUDIO_DIR WASM_BUILD_DIR
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const [port, models, audio, build] = process.argv.slice(2);
const here = new URL('.', import.meta.url).pathname;
const roots = { '/models/': models, '/audio/': audio, '/build/': build, '/': here };
const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.json': 'application/json', '.wav': 'audio/wav', '.txt': 'text/plain',
};

createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const prefix = Object.keys(roots).find((p) => path.startsWith(p));
    const file = join(roots[prefix], normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, ''));
    let size;
    try {
        size = statSync(file).size;
    } catch {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': size,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1');
