import type { Line, Word } from "./run";
import type { ExportFormat } from "./types";

export const EXPORT_NAMES: Record<ExportFormat, string> = { txt: "Text", srt: "SubRip subtitles", vtt: "WebVTT subtitles" };

const TIMED = /^\[(\d+):(\d{2}):(\d{2}(?:\.\d+)?) --> (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\] ?(.*)$/;

function seconds(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export type Transcript = { lines: Line[]; speakers: string[] };

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

export function nextSpeaker(speaker: number | undefined, count: number): number | undefined {
  return count > 1 ? ((speaker ?? 0) + 1) % count : speaker;
}

export type Placed = { word: Word; from: number; to: number };

const LONGEST_GAP = 80;

/** Finds each timed word in the text in order. A word a correction removed is left out. */
export function placeWords(text: string, words: Word[] = []): Placed[] {
  const placed: Placed[] = [];
  let from = 0;
  for (const word of words) {
    const at = text.indexOf(word.text, from);
    if (at < 0 || at - from > LONGEST_GAP) continue;
    placed.push({ word, from: at, to: at + word.text.length });
    from = at + word.text.length;
  }
  return placed;
}

export function wordAt(placed: Placed[], seconds: number): number {
  return placed.findIndex(({ word }) => word.start <= seconds && seconds < word.end);
}

/** Cuts a line in two at a character of its text: at the time of the word there, or else by the length of each half. */
export function splitLine(lines: Line[], index: number, text: string, at: number, count: number): Line[] {
  const line = lines[index];
  const before = text.slice(0, at).trim();
  const after = text.slice(at).trim();
  const placed = placeWords(text, line.words);
  const next = placed.find((p) => p.from >= at)?.word.start;
  const cut =
    next !== undefined && next > line.start && next < line.end
      ? next
      : line.start + ((line.end - line.start) * before.length) / (before.length + after.length || 1);
  const words = (second: boolean) => line.words && placed.filter((p) => p.from >= at === second).map((p) => p.word);
  return [
    ...lines.slice(0, index),
    { ...line, text: before, end: cut, words: words(false) },
    { ...line, text: after, start: cut, speaker: nextSpeaker(line.speaker, count), words: words(true) },
    ...lines.slice(index + 1),
  ];
}

export function joinLine(lines: Line[], index: number, text: string): { lines: Line[]; index: number; at: number } | null {
  let into = index - 1;
  while (into >= 0 && !lines[into].text) into--;
  if (into < 0) return null;
  const earlier = lines[into];
  const later = lines[index];
  const joined = [earlier.text, text.trim()].filter(Boolean).join(" ");
  const words = earlier.words || later.words ? [...(earlier.words ?? []), ...(later.words ?? [])] : undefined;
  return {
    lines: [
      ...lines.slice(0, into),
      { ...earlier, text: joined, end: Math.max(earlier.end, later.end), words },
      ...lines.slice(into + 1, index),
      ...lines.slice(index + 1),
    ],
    index: into,
    at: earlier.text.length + (text.trim() ? 1 : 0),
  };
}

export function assignSpeaker(lines: Line[], index: number, speaker: number): Line[] {
  return lines.map((line, i) => (i === index ? { ...line, speaker } : line));
}

export function removeUnusedSpeakers(transcript: Transcript): Transcript {
  const used = new Set(transcript.lines.filter((line) => line.text.trim()).map((line) => line.speaker));
  const kept = transcript.speakers.flatMap((name, index) => (used.has(index) ? [{ name, index }] : []));
  if (kept.length === transcript.speakers.length) return transcript;
  const positions = new Map(kept.map(({ index }, position) => [index, position]));
  return {
    speakers: kept.map(({ name }) => name),
    lines: transcript.lines.map((line) => ({ ...line, speaker: line.speaker === undefined ? undefined : positions.get(line.speaker) })),
  };
}

/** Speakers have eight colours, so a transcript names at most eight. */
export const MAX_SPEAKERS = 8;

export function addSpeaker(speakers: string[], lines: Line[]): Transcript {
  const taken = new Set(speakers.map((name) => name.toLowerCase()));
  const named = speakers.length === 0 ? ["Speaker 1"] : [...speakers];
  let n = named.length + 1;
  while (taken.has(`speaker ${n}`)) n++;
  named.push(`Speaker ${n}`);
  return { speakers: named, lines: speakers.length <= 1 ? lines.map((line) => ({ ...line, speaker: line.speaker ?? 0 })) : lines };
}

export function findMatches(lines: Line[], needle: string): number[] {
  if (!needle) return [];
  return lines.flatMap((line, i) => (line.text.toLowerCase().includes(needle) ? [i] : []));
}
