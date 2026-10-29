const GIB = 2 ** 30;
const HEADROOM = GIB;
const SAMPLE_BYTES = 16_000 * 4;

export type MemoryCheck = { kind: "ok" } | { kind: "unknown" } | { kind: "refuse"; message: string; total: number };

/** Three copies of the decoded audio, as the desktop guard estimates. */
export function audioBytes(seconds: number): number {
  return Math.ceil(seconds) * SAMPLE_BYTES * 3;
}

/**
 * The browser reports no free memory, only the device's total, rounded down and absent outside
 * Chromium. So the model's measured peak, the audio and 1 GB must fit in that total.
 */
export function checkMemory(deviceMemoryGb: number | undefined, peakBytes: number, audioSeconds: number): MemoryCheck {
  if (deviceMemoryGb === undefined || !Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) return { kind: "unknown" };
  const total = deviceMemoryGb * GIB;
  const need = peakBytes + audioBytes(audioSeconds) + HEADROOM;
  if (need <= total) return { kind: "ok" };
  return {
    kind: "refuse",
    total,
    message: `The browser version needs about ${(need / GIB).toFixed(1)} GB of memory, and this computer has ${(total / GIB).toFixed(0)} GB.`,
  };
}

export type StorageEstimate = { quota?: number; usage?: number };

/** Before a download, the browser's storage quota must hold the files plus 1 GB. */
export function checkStorage(estimate: StorageEstimate | null, missingBytes: number): string | null {
  if (!estimate || estimate.quota === undefined) return null;
  const free = estimate.quota - (estimate.usage ?? 0);
  if (missingBytes + HEADROOM <= free) return null;
  return `Not enough browser storage: the model needs ${(missingBytes / GIB).toFixed(1)} GB plus 1.0 GB to spare, and the browser allows ${(Math.max(0, free) / GIB).toFixed(1)} GB more. Free up disk space first.`;
}
