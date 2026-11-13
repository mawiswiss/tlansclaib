export async function readInChunks(size: number, read: (offset: number) => Promise<ArrayBuffer>): Promise<Blob> {
  let blob = new Blob([]);
  while (blob.size < size) {
    const chunk = await read(blob.size);
    if (chunk.byteLength === 0) break;
    blob = new Blob([blob, chunk]);
  }
  return blob;
}

export function releaseAudioUrl(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
