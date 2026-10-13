import { gib } from "../lib/format";
import type { Stats } from "../lib/types";

type Props = { stats: Stats | null; running: boolean };

export function SystemBar({ stats, running }: Props) {
  if (!stats) return <footer className="system muted">Reading system usage…</footer>;
  const warn = stats.memory_free < 1.5 * 2 ** 30;
  return (
    <footer className={`system${warn ? " warn" : ""}`}>
      <span>CPU {Math.round(stats.cpu)}%</span>
      <span>
        Memory {gib(stats.memory_used)} of {gib(stats.memory_total)} used, {gib(stats.memory_free)} free
      </span>
      {stats.swap_total > 0 && <span>Swap {gib(stats.swap_used)}</span>}
      {running && stats.engine_memory > 0 && <span>Engine {gib(stats.engine_memory)}</span>}
      {warn && <span className="badge">Memory is getting low</span>}
    </footer>
  );
}
