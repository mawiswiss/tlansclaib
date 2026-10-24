import type { Line } from "./run";
import type { ExportFormat } from "./types";

export const EXPORT_NAMES: Record<ExportFormat, string> = { txt: "Text", srt: "SubRip subtitles", vtt: "WebVTT subtitles" };

const TIMED = /^\[(\d+):(\d{2}):(\d{2}(?:\.\d+)?) --> (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\] ?(.*)$/;

function seconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export type Parsed = { lines: Line[]; timestamps: boolean };

function spoken(text: string, speakers: string[]): { text: string; speaker?: number } {
  const speaker = speakers.findIndex((name) => text.startsWith(`${name}: `));
  return speaker < 0 ? { text } : { text: text.slice(speakers[speaker].length + 2), speaker };
}

export function parseTranscript(text: string, speakers: string[] = []): Parsed {
  const rows = text.split(/\r?\n/).filter((row) => row.trim() !== "");
  const timed = rows.map((row) => TIMED.exec(row));
  if (rows.length > 0 && timed.every(Boolean)) {
    return {
      timestamps: true,
      lines: timed.map((m) => ({ start: seconds(m![1], m![2], m![3]), end: seconds(m![4], m![5], m![6]), ...spoken(m![7], speakers) })),
    };
  }
  return { timestamps: false, lines: rows.map((row, i) => ({ start: i, end: i, ...spoken(row, speakers) })) };
}

const LONGEST_LINE_SECONDS = 60;

export type Playing = { lines: number[]; main: number };

/** Every line under the playhead, and the longest of them, so a short reply over a long turn does not take the view. */
export function playingAt(lines: Line[], seconds: number): Playing {
  let low = 0;
  let high = lines.length - 1;
  let started = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].start <= seconds) {
      started = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const covering: number[] = [];
  let finished = -1;
  for (let i = started; i >= 0 && lines[i].start >= seconds - LONGEST_LINE_SECONDS; i--) {
    const line = lines[i];
    if (seconds < line.end) covering.unshift(i);
    else if (finished < 0 || line.end > lines[finished].end) finished = i;
  }
  if (covering.length === 0) {
    const main = finished >= 0 ? finished : started;
    return { lines: main >= 0 ? [main] : [], main };
  }
  const length = (i: number) => lines[i].end - lines[i].start;
  const main = covering.reduce((best, i) => (length(i) > length(best) ? i : best));
  return { lines: covering, main };
}

/** Gives the lines of a file saved without timecodes the times kept for it, when they still match. */
export function withTimes(parsed: Parsed, times: [number, number][] | null | undefined): Parsed & { timed: boolean } {
  if (parsed.timestamps) return { ...parsed, timed: true };
  if (!times || times.length !== parsed.lines.length || times.length === 0) return { ...parsed, timed: false };
  return { ...parsed, timed: true, lines: parsed.lines.map((line, i) => ({ ...line, start: times[i][0], end: times[i][1] })) };
}

export function lineAt(lines: Line[], seconds: number): number {
  return playingAt(lines, seconds).main;
}

export function findMatches(lines: Line[], needle: string): number[] {
  if (!needle) return [];
  return lines.flatMap((line, i) => (line.text.toLowerCase().includes(needle) ? [i] : []));
}
