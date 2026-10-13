import { useEffect, useRef, useState } from "react";
import { clock, duration, fileName, remaining, speed } from "../lib/format";
import { estimate, type RunState } from "../lib/run";
import type { Step } from "../lib/types";

type Props = { run: RunState; onCancel: () => void };

const STEPS: { step: Step; title: string }[] = [
  { step: "decode", title: "Reading the audio" },
  { step: "load", title: "Loading the model" },
  { step: "transcribe", title: "Transcribing" },
  { step: "write", title: "Writing the files" },
];

function deviceName(device: string | null): string {
  if (device === "metal") return "Apple GPU";
  if (device === "cuda") return "NVIDIA GPU";
  return "CPU";
}

export function RunView({ run, onCancel }: Props) {
  const [now, setNow] = useState(Date.now());
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [run.lines.length]);

  const order = STEPS.findIndex((s) => s.step === run.step);
  const est = estimate(run, now);
  const elapsed = (now - run.startedAt) / 1000;
  const percent = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;

  const detail = (step: Step): string => {
    switch (step) {
      case "decode":
        return run.audioSeconds !== null ? `${clock(run.audioSeconds)} of audio` : "";
      case "load":
        return run.device ? `${run.modelName} on the ${deviceName(run.device)}, ${run.threads} threads` : run.modelName;
      case "transcribe":
        return run.total > 0 ? `${run.done} of ${run.total} windows` : "";
      case "write":
        return "";
    }
  };

  return (
    <section className="run">
      <header>
        <h2>{fileName(run.audio)}</h2>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </header>
      <ol className="steps">
        {STEPS.map((s, i) => {
          const state = i < order ? "done" : i === order ? "active" : "pending";
          return (
            <li key={s.step} className={state}>
              <span className="marker" />
              <span className="title">{s.title}</span>
              <span className="detail">{detail(s.step)}</span>
            </li>
          );
        })}
      </ol>
      {run.step === "transcribe" && (
        <div className="progress">
          <div className="bar">
            <div className="fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="stats">
            <span>{percent}%</span>
            <span>
              at {clock(run.position)} of {run.audioSeconds !== null ? clock(run.audioSeconds) : "…"}
            </span>
            <span>{duration(elapsed)} elapsed</span>
            <span>{est ? `${remaining(est.remainingSeconds)} left` : "estimating time left"}</span>
            {est && <span>{speed(run.position, (now - (run.transcribeStartedAt ?? now)) / 1000)}</span>}
          </div>
        </div>
      )}
      {run.step !== "transcribe" && <p className="muted">{duration(elapsed)} elapsed</p>}
      <div className="log" ref={log}>
        {run.lines.slice(-200).map((line, i) => (
          <p key={`${line.start}-${i}`}>
            <span className="time">{clock(line.start)}</span>
            <span className={line.text ? "" : "muted"}>{line.text || "(nothing recognised)"}</span>
          </p>
        ))}
      </div>
    </section>
  );
}
