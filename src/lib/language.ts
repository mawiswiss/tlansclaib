import type { Heard } from "./types";

const CLEAR = 0.6;
const ABSENT = 0.1;

export function differs(chosen: string | null, heard: Heard[]): string | null {
  if (!chosen || chosen === "auto") return null;
  const [top] = heard;
  if (!top || top.code === chosen || top.probability < CLEAR) return null;
  const share = heard.find((h) => h.code === chosen)?.probability ?? 0;
  return share < ABSENT ? top.code : null;
}
