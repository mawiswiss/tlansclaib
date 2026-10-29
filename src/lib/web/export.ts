// Port of `render` in engine/src/output.rs and `subtitles` in src-tauri/src/transcript.rs.
import type { Line } from "../run";
import type { ExportFormat } from "../types";
import { Refusal } from "./refusal";

function stamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds - hours * 3600) / 60);
  const rest = seconds - hours * 3600 - minutes * 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function spoken(line: Line, speakers: string[]): string {
  const name = line.speaker === undefined ? undefined : speakers[line.speaker];
  return name ? `${name}: ${line.text}` : line.text;
}

export function render(lines: Line[], timestamps: boolean, speakers: string[]): string {
  return lines
    .filter((l) => l.text !== "")
    .map((l) => (timestamps ? `[${stamp(l.start)} --> ${stamp(l.end)}] ${spoken(l, speakers)}\n` : `${spoken(l, speakers)}\n`))
    .join("");
}

function subtitles(lines: Line[], speakers: string[], vtt: boolean): string {
  const separator = vtt ? "." : ",";
  const time = (seconds: number) => {
    const millis = Math.round(Math.max(0, seconds) * 1000);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(Math.floor(millis / 3_600_000))}:${two(Math.floor(millis / 60_000) % 60)}:${two(Math.floor(millis / 1000) % 60)}${separator}${String(millis % 1000).padStart(3, "0")}`;
  };
  const cues = lines
    .filter((l) => l.text !== "")
    .map((l, i) => `${vtt ? "" : `${i + 1}\n`}${time(l.start)} --> ${time(l.end)}\n${spoken(l, speakers)}\n\n`);
  return (vtt ? "WEBVTT\n\n" : "") + cues.join("");
}

export function exported(format: ExportFormat, lines: Line[], timestamps: boolean, timed: boolean, speakers: string[]): string {
  if (format === "txt") return render(lines, timestamps, speakers);
  if (!timed) throw new Refusal("This transcript has no line timing for subtitles.");
  return subtitles(lines, speakers, format === "vtt");
}
