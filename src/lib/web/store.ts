// Cache Storage refused the 370 MB encoder in Chrome 152 ("Unexpected internal error"), so the files live in OPFS.
import { FILES, FOLDER, REVISION, type Pinned } from "./model";
import { Refusal } from "./refusal";

async function folder(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true });
}

async function stored(dir: FileSystemDirectoryHandle, file: Pinned): Promise<File | null> {
  try {
    const found = await (await dir.getFileHandle(file.sha256)).getFile();
    return found.size === file.size ? found : null;
  } catch {
    return null;
  }
}

export async function isInstalled(): Promise<boolean> {
  const dir = await folder();
  for (const file of FILES) if (!(await stored(dir, file))) return false;
  return true;
}

export async function remove(): Promise<void> {
  await (await navigator.storage.getDirectory()).removeEntry(FOLDER, { recursive: true }).catch(() => {});
}

// transformers.js 4.3.1 probes `resolve/main/` whatever revision it was given, so a model file matches by its path.
export async function read(url: string): Promise<Response | undefined> {
  const path = /\/resolve\/[^/]+\/(.+)$/.exec(url)?.[1];
  const file = FILES.find((f) => f.url === url || (path !== undefined && f.url.endsWith(`/resolve/${REVISION}/${path}`)));
  const found = file && (await stored(await folder(), file));
  return found ? new Response(found, { headers: { "content-length": String(found.size) } }) : undefined;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchPinned(file: Pinned, signal: AbortSignal, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const name = file.url.split("/").pop();
  const response = await fetch(file.url, { signal, cache: "no-store" });
  if (!response.ok || !response.body) throw new Refusal(`the server answered ${response.status} for ${name}`);
  const data = new Uint8Array(file.size);
  let at = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > file.size) throw new Refusal(`${name} is larger than expected`);
    data.set(value, at);
    at += value.length;
    onBytes(value.length);
  }
  if (at !== file.size) throw new Refusal(`${name} is ${at} bytes instead of ${file.size}`);
  return data;
}

/** Downloads every file that is missing, and stores each only after its size and SHA-256 match. */
export async function install(signal: AbortSignal, onProgress: (bytes: number, total: number) => void): Promise<void> {
  const dir = await folder();
  const total = FILES.reduce((sum, f) => sum + f.size, 0);
  let bytes = 0;
  for (const file of FILES) {
    if (await stored(dir, file)) {
      bytes += file.size;
      onProgress(bytes, total);
      continue;
    }
    const data = await fetchPinned(file, signal, (n) => {
      bytes += n;
      onProgress(bytes, total);
    });
    if ((await sha256(data)) !== file.sha256) throw new Refusal(`${file.url.split("/").pop()} does not match its checksum, so it was not kept`);
    const writable = await (await dir.getFileHandle(file.sha256, { create: true })).createWritable();
    await writable.write(data);
    await writable.close();
  }
}
