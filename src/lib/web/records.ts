import type { Line } from "../run";
import type { HistoryEntry } from "../types";
import { Refusal } from "./refusal";

export type Stored = Omit<HistoryEntry, "exists" | "audio_exists">;

export type Record = { entry: Stored; lines: Line[]; revision: number; audio_size: number };

const LIMIT = 500;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tlansclaib", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "entry.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction("records", mode).objectStore("records"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function all(): Promise<Record[]> {
  const records = await transact<Record[]>("readonly", (s) => s.getAll());
  return records.sort((a, b) => b.entry.finished_at - a.entry.finished_at);
}

export function get(id: number): Promise<Record | undefined> {
  return transact<Record | undefined>("readonly", (s) => s.get(id));
}

export async function put(record: Record): Promise<void> {
  await transact("readwrite", (s) => s.put(record));
  const records = await all();
  for (const old of records.slice(LIMIT)) await remove(old.entry.id);
}

export async function remove(id: number): Promise<void> {
  await transact("readwrite", (s) => s.delete(id));
}

export function fileOf(id: number): string {
  return `browser-${id}.json`;
}

export function idOf(file: string): number {
  const id = Number(/^browser-(\d+)\.json$/.exec(file)?.[1]);
  if (!Number.isFinite(id)) throw new Refusal("This transcript is not in the browser's history.");
  return id;
}
