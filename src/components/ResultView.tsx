import { useEffect, useState } from "react";
import { clock, duration, fileName, speed } from "../lib/format";
import type { RunState } from "../lib/run";

type Props = {
  run: RunState;
  onOpenFolder: (path: string) => void;
  onCopy: () => Promise<void>;
  onAnother: () => void;
};

export function ResultView({ run, onOpenFolder, onCopy, onAnother }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const result = run.result!;
  const text = run.lines.map((l) => l.text).filter(Boolean).join("\n");
  return (
    <section className="result">
      <header>
        <h2>Done: {fileName(run.audio)}</h2>
        <p>
          {result.lines} lines
          {run.audioSeconds !== null && <> from {clock(run.audioSeconds)} of audio</>} in {duration(result.elapsed)}
          {run.audioSeconds !== null && <>, {speed(run.audioSeconds, result.elapsed)}</>}
        </p>
        <p className="muted">
          Saved as {fileName(result.txt)} and {fileName(result.timestamps)}
        </p>
      </header>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onOpenFolder(result.txt)}>
          Show in folder
        </button>
        <button type="button" onClick={() => onCopy().then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy text"}
        </button>
        <button type="button" onClick={onAnother}>
          Transcribe another file
        </button>
      </div>
      <pre className="transcript">{text || "(nothing recognised)"}</pre>
    </section>
  );
}
