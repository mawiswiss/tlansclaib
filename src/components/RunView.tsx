import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clock, duration, fileName, remaining, speed } from "../lib/format";
import { differs } from "../lib/language";
import { overdue, usual } from "../lib/pace";
import { estimate, type RunState } from "../lib/run";
import { colorOf } from "../lib/transcript";
import type { HistoryEntry, Step } from "../lib/types";
import { Check } from "./icons";

type Props = {
  run: RunState;
  history: HistoryEntry[];
  smaller: boolean;
  showTimes: boolean;
  languageName: (code: string) => string;
  onCancel: () => void;
  onRestart: (language: string | null) => void;
};

const STEPS: { step: Step; title: string; short: string }[] = [
  { step: "decode", title: "Reading the audio", short: "Audio" },
  { step: "speakers", title: "Finding the speakers", short: "Speakers" },
  { step: "load", title: "Loading the model", short: "Model" },
  { step: "transcribe", title: "Transcribing", short: "Transcribing" },
  { step: "write", title: "Saving", short: "Saving" },
];

function advice(step: Step, smaller: boolean): string | null {
  switch (step) {
    case "decode":
      return "If it seems stuck, start it over.";
    case "speakers":
      return "If it seems stuck, start it over, or cancel and transcribe without naming the speakers.";
    case "load":
      return smaller ? "If it seems stuck, start it over, or cancel and choose a smaller model." : "If it seems stuck, start it over.";
    case "transcribe":
      return smaller
        ? "If it stays this slow, close other programs, start it over from the beginning, or cancel and choose a smaller model."
        : "If it stays this slow, close other programs or start it over from the beginning.";
    case "write":
      return null;
  }
}

const LOAD_PARTS = { file: "Reading the file", device: "Starting up", language: "Language check" };

function deviceName(device: string | null): string {
  return device === "metal" ? "Metal" : device === "vulkan" ? "Vulkan" : device === "webgpu" ? "WebGPU" : "CPU";
}

export function RunView({ run, history, smaller, showTimes, languageName, onCancel, onRestart }: Props) {
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
  const current = STEPS.find((s) => s.step === run.step) ?? null;
  const expected = run.step ? usual(run.step, { audioSeconds: run.audioSeconds, modelId: run.modelId, speakerBackend: run.speakerBackend, device: run.device }, history) : null;
  const stepSeconds = run.stepStartedAt !== null ? (now - run.stepStartedAt) / 1000 : null;
  const heading = transcribing && est && stepSeconds !== null && run.done >= run.total * 0.1 ? stepSeconds + est.remainingSeconds : null;
  const late = expected && stepSeconds !== null && (overdue(stepSeconds, expected) || (heading !== null && overdue(heading, expected)));

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
            <p className="hint">{run.modelName}</p>
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
                  <span className="marker">{state === "done" && <Check size={16} />}</span>
                  <span className="title">
                    <span className="long">{s.title}</span>
                    <span className="short">{s.short}</span>
                  </span>
                </span>
                <span className="detail" title={text}>
                  {text || " "}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="progress">
          <span className="meter" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <i style={{ width: `${percent}%` }} />
          </span>
          <div className="stats data tabular">
            <strong>{percent}%</strong>
            <span>{duration(elapsed)} elapsed</span>
            {transcribing && <span>{est ? `${remaining(est.remainingSeconds)} left` : "estimating time left"}</span>}
            {transcribing && est && <span>{speed(run.position, (now - (run.transcribeStartedAt ?? now)) / 1000)}</span>}
            {!late && current && expected?.measured && <span>{current.title} usually takes about {duration(expected.seconds)}</span>}
          </div>
        </div>
        {late && current && expected && stepSeconds !== null && (
          <div role="status" className="t-note warn">
            <span className="dot warn" />
            <div>
              <p>
                {current.title} is taking longer than {expected.measured ? "usual" : "expected"}:{" "}
                {overdue(stepSeconds, expected) ? `${duration(stepSeconds)} so far` : `heading for about ${duration(heading!)}`},{" "}
                {expected.measured ? `earlier runs took about ${duration(expected.seconds)}` : `it usually takes under ${duration(expected.seconds)}`}. It may still finish.
                {advice(current.step, smaller) && ` ${advice(current.step, smaller)}`}
              </p>
              {advice(current.step, smaller) && (
                <div className="t-note-actions">
                  <button type="button" onClick={() => onRestart(null)}>
                    Start over
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {run.retryReason && <p role="status" className="hint">{run.retryReason}</p>}
        {spoken && run.language && (
          <div role="status" className="t-note">
            <span className="dot" />
            <div>
              <p>
                This sounds like {languageName(spoken)}, but the language is set to {languageName(run.language)}. The transcript may come out in {languageName(run.language)}.
              </p>
              <div className="t-note-actions">
                <button type="button" onClick={() => onRestart(spoken)}>
                  Restart in {languageName(spoken)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="log lines card" ref={log} onScroll={onScroll}>
        {run.lines.length === 0 && <p className="muted">Text appears here as it is recognized.</p>}
        {run.lines.map((line) => {
          const speaker = line.speaker !== undefined && line.text ? run.speakers[line.speaker] : undefined;
          const meta = showTimes || voiced;
          return (
            <p key={`${line.start}-${line.speaker ?? 0}`} className={`line${meta ? " has-meta" : ""}`}>
              {meta && (
                <span className="line-meta">
                  {showTimes && <span className="time">{clock(line.start)}</span>}
                  {voiced && speaker !== undefined && (
                    <span className={`who s${colorOf(run.colors, line.speaker!)}`}>
                      <span className="line-dot" />
                      <span className="who-name">{speaker}</span>
                    </span>
                  )}
                </span>
              )}
              <span className={`line-text${line.text ? "" : " muted"}`} dir="auto">
                {line.text || "(nothing recognized)"}
              </span>
            </p>
          );
        })}
      </div>
    </section>
  );
}
