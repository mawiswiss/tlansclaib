import type { Line } from "../run";
import type { HistoryEntry } from "../types";
import { Refusal } from "./refusal";

export type Stored = Omit<HistoryEntry, "exists" | "audio_exists">;

export type Record = { entry: Stored; lines: Line[]; revision: number };

const LIMIT = 500;

const records = new Map<number, Record>();

export async function all(): Promise<Record[]> {
  return [...records.values()].sort((a, b) => b.entry.finished_at - a.entry.finished_at);
}

export async function get(id: number): Promise<Record | undefined> {
  return records.get(id);
}

export async function put(record: Record): Promise<void> {
  records.set(record.entry.id, record);
  for (const old of (await all()).slice(LIMIT)) records.delete(old.entry.id);
}

export async function remove(id: number): Promise<void> {
  records.delete(id);
}

export function fileOf(id: number): string {
  return `browser-${id}.json`;
}

export function idOf(file: string): number {
  const id = Number(/^browser-(\d+)\.json$/.exec(file)?.[1]);
  if (!Number.isFinite(id)) throw new Refusal("This transcript is not one of this page's.");
  return id;
}
