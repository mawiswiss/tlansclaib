import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clock, duration, fileName, remaining, speed } from "../lib/format";
import { differs } from "../lib/language";
import { estimate, type RunState } from "../lib/run";
import type { Step } from "../lib/types";
import { Check } from "./icons";

type Props = {
  run: RunState;
  showTimes: boolean;
  languageName: (code: string) => string;
  onCancel: () => void;
  onRestart: (language: string) => void;
};

const STEPS: { step: Step; title: string; short: string }[] = [
  { step: "decode", title: "Reading the audio", short: "Audio" },
  { step: "speakers", title: "Finding the speakers", short: "Speakers" },
  { step: "load", title: "Loading the model", short: "Model" },
  { step: "transcribe", title: "Transcribing", short: "Transcribing" },
  { step: "write", title: "Saving", short: "Saving" },
];

const LOAD_PARTS = { file: "Reading the file", device: "Starting up", language: "Language check" };

function deviceName(device: string | null): string {
  return device === "metal" ? "Metal" : device === "vulkan" ? "Vulkan" : "CPU";
}

export function RunView({ run, showTimes, languageName, onCancel, onRestart }: Props) {
  const [now, setNow] = useState(Date.now());
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [run.lines.length]);

  const onScroll = () => {
    const el = log.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };

  const steps = run.detecting ? STEPS : STEPS.filter((s) => s.step !== "speakers");
  const voiced = run.speakers.length > 1;
  const order = steps.findIndex((s) => s.step === run.step);
  const transcribing = run.step === "transcribe";
  const est = estimate(run, now);
  const elapsed = (now - run.startedAt) / 1000;
  const percent = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
  const spoken = differs(run.language, run.heard);

  const detail = (step: Step): string => {
    switch (step) {
      case "decode":
        return run.audioSeconds !== null ? `${clock(run.audioSeconds)} of audio` : "";
      case "speakers":
        if (run.step === "speakers") return run.speakerProgress !== null ? `${Math.round(run.speakerProgress * 100)}%` : "";
        if (run.voices !== null) return run.voices > 1 ? `${run.voices} people` : "1 person";
        return run.speakerProgress === null && run.speakers.length > 1 ? "One per audio track" : "";
      case "load": {
        if (run.step === "load" && !run.device) return LOAD_PARTS[run.loadPart ?? "file"];
        if (!run.device) return "";
        const device = run.deviceName ? `${deviceName(run.device)}: ${run.deviceName}` : deviceName(run.device);
        return run.language ? `${device} · ${languageName(run.language)}` : device;
      }
      case "transcribe":
        return "";
      case "write":
        return "";
    }
  };

  return (
    <section className="run">
      <div className="card run-card">
        <header className="card-head">
          <div className="titles">
            <h2>{fileName(run.audio)}</h2>
            <p className="muted">{run.modelName}</p>
          </div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </header>
        <ol className={`steps${steps.length > 4 ? " many" : ""}`}>
          {steps.map((s, i) => {
            const state = i < order ? "done" : i === order ? "active" : "pending";
            const text = detail(s.step);
            return (
              <li key={s.step} className={state}>
                <span className="step-head">
                  <span className="marker">{state === "done" && <Check size={12} strokeWidth={2.6} />}</span>
                  <span className="title">
                    <span className="long">{s.title}</span>
                    <span className="short">{s.short}</span>
                  </span>
                </span>
                <span className="detail" title={text}>
                  {text || " "}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="progress">
          <div className="bar">
            <div className="fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="stats">
            <strong>{percent}%</strong>
            <span>{duration(elapsed)} elapsed</span>
            {transcribing && <span>{est ? `${remaining(est.remainingSeconds)} left` : "estimating time left"}</span>}
            {transcribing && est && <span>{speed(run.position, (now - (run.transcribeStartedAt ?? now)) / 1000)}</span>}
          </div>
        </div>
        {run.retryReason && <p role="status" className="muted">{run.retryReason}</p>}
        {spoken && run.language && (
          <p role="status" className="note">
            This sounds like {languageName(spoken)}. Recording language is {languageName(run.language)}, so the transcript may come out in{" "}
            {languageName(run.language)}.{" "}
            <button type="button" className="inline-link" onClick={() => onRestart(spoken)}>
              Restart in {languageName(spoken)}
            </button>
          </p>
        )}
      </div>
      <div className="log card" ref={log} onScroll={onScroll}>
        {run.lines.length === 0 && <p className="muted">The text appears here as it is recognised.</p>}
        {run.lines.map((line) => {
          const speaker = line.speaker !== undefined && line.text ? run.speakers[line.speaker] : undefined;
          return (
            <p key={`${line.start}-${line.speaker ?? 0}`} className={[showTimes ? "timed" : "", voiced ? "voiced" : ""].join(" ").trim() || undefined}>
              {showTimes && <span className="time">{clock(line.start)}</span>}
              {voiced && <span className={`line-dot${speaker !== undefined ? ` s${line.speaker! % 8}` : ""}`} title={speaker} />}
              <span className={line.text ? "" : "muted"}>{line.text || "(nothing recognised)"}</span>
            </p>
          );
        })}
      </div>
    </section>
  );
}
