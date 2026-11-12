import { FEATURES } from "../lib/ipc";
import type { ReactNode } from "react";
import { AUTHOR, YEAR } from "../lib/about";
import { level, memoryLevel, type Level } from "../lib/fit";
import { wholeGb } from "../lib/format";
import type { Stats } from "../lib/types";
import { Tooltip } from "./Tooltip";

type Props = { stats: Stats | null; running: boolean; onCredit: () => void };

function Meter({ value, state }: { value: number; state: Level }) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <span className={`meter ${state}`} aria-hidden="true">
      <span style={{ width: `${Math.round(clamped * 100)}%` }} />
    </span>
  );
}

const LEVEL_WORD: Record<Level, string> = { ok: "", warn: "High", high: "Very high" };

function ramNote(state: Level, fraction: number): string | null {
  if (state === "ok") return null;
  if (state === "warn") return "Memory use is above 70%. Close programs you don't need.";
  return fraction >= 0.9
    ? "Memory use is above 90%. Close programs, or a transcription may stop."
    : "Memory is almost full. Close programs, or a transcription may stop.";
}

function cpuNote(state: Level, running: boolean): string | null {
  if (state === "ok") return null;
  if (running) return "The transcription is using the processor. Other programs may feel slower.";
  return state === "high" ? "Processor use is above 90%. A transcription would run much slower." : "Processor use is above 70%. A transcription would run slower.";
}

function Stat({ note, state, children }: { note: string | null; state: Level; children: ReactNode }) {
  if (!note) return <span className="stat">{children}</span>;
  return (
    <Tooltip content={note} oneLine>
      <span className="stat" tabIndex={0}>
        {children}
        <span className="stat-word">{LEVEL_WORD[state]}</span>
      </span>
    </Tooltip>
  );
}

export function SystemBar({ stats, running, onCredit }: Props) {
  const credit = (
    <button type="button" className="credit" onClick={onCredit}>
      © {YEAR} · <span className="credit-more">Developed by </span>
      {AUTHOR}
    </button>
  );
  if (!FEATURES.systemStats) {
    return <footer className="system">{credit}</footer>;
  }
  if (!stats) {
    return (
      <footer className="system">
        <span className="muted">Reading memory and processor use…</span>
        {credit}
      </footer>
    );
  }
  const cpu = stats.cpu / 100;
  const ram = stats.memory_used / stats.memory_total;
  const cpuState = level(cpu);
  const ramState = memoryLevel(stats);
  return (
    <footer className="system">
      <Stat note={cpuNote(cpuState, running)} state={cpuState}>
        CPU <Meter value={cpu} state={cpuState} /> {Math.round(stats.cpu)}%
      </Stat>
      <Stat note={ramNote(ramState, ram)} state={ramState}>
        RAM <Meter value={ram} state={ramState} /> {wholeGb(stats.memory_used).replace(" GB", "")} of {wholeGb(stats.memory_total)}
        {running && stats.engine_memory > 0 && <span className="muted"> (the transcription uses {wholeGb(stats.engine_memory)})</span>}
      </Stat>
      {credit}
    </footer>
  );
}
