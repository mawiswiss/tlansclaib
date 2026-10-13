export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 && m < 10 ? `${m} min ${s} s` : `${m} min`;
}

export function remaining(seconds: number): string {
  if (!Number.isFinite(seconds)) return "estimating";
  if (seconds < 10) return "a few seconds";
  const total = Math.round(seconds);
  if (total < 60) return `about ${Math.ceil(total / 10) * 10} s`;
  const h = Math.floor(total / 3600);
  const m = Math.ceil((total % 3600) / 60);
  if (h > 0) return `about ${h} h ${m} min`;
  return `about ${m} min`;
}

export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

export function gib(n: number): string {
  return `${(n / 2 ** 30).toFixed(1)} GB`;
}

export function speed(audioSeconds: number, elapsedSeconds: number): string {
  if (elapsedSeconds <= 0 || audioSeconds <= 0) return "";
  const factor = audioSeconds / elapsedSeconds;
  return factor >= 10 ? `${Math.round(factor)}x real time` : `${factor.toFixed(1)}x real time`;
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}
