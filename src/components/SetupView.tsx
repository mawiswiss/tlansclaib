import { useState, type ReactNode } from "react";
import { budgetFit, downloadFit, downloadSeconds, VERY_FAST, type Score } from "../lib/fit";
import { bytes, gib, wholeGb } from "../lib/format";
import { DEVICE, FEATURES } from "../lib/ipc";
import { defaultModel, languageKey, missingBytes, MODE_DETECTION, MODE_NAMES, MODES, parseLanguage, recommend, SEVERAL, setupLanguages, wanted, withSelectedLanguage, type Mode, type Setup, type SetupLanguage } from "../lib/setup";
import type { DiskSpace, Gpu, Language, ModelStatus, SpeakerDetection, Stats } from "../lib/types";
import { ChevronDown } from "./icons";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";

type Props = {
  variant: "page" | "dialog";
  models: ModelStatus[];
  detections: SpeakerDetection[];
  languages: Language[];
  setup: Setup | null;
  speed: number | "measuring" | "offline";
  speedError: string | null;
  gpu: Gpu | null;
  stats: Stats | null;
  score: Score | null;
  disk: DiskSpace | null;
  busy: boolean;
  error: string | null;
  leftoverBytes: number;
  showDetails?: boolean;
  onApply: (setup: Setup) => void;
  onMeasureAgain: () => void;
  onRemoveLeftovers: () => void;
  onToggleDetails?: () => void;
  children: (selected: Setup | null) => ReactNode;
};

const PITCH: Record<Mode, string> = FEATURES.mobile
  ? {
      precise: "Most accurate results, with the biggest models.",
      essential: "Mid-sized models for phones with less memory or slower internet.",
      minimal: "One small model. For when the others don't run.",
    }
  : {
      precise: "Most accurate results, with the biggest models.",
      essential: "Mid-sized models for older computers or slower internet.",
      minimal: "One small model and basic speaker detection. For when the others don't run.",
    };

const SPEAKERS: Record<Mode, string> = FEATURES.mobile ? { precise: "Detected", essential: "Detected", minimal: "Detected" } : { precise: "Better detection", essential: "Better detection", minimal: "Basic detection" };

const BARS: Record<Mode, number> = { precise: 12, essential: 8, minimal: 5 };

function Wave({ mode }: { mode: Mode }) {
  const count = BARS[mode];
  const played = Math.ceil(count * 0.4);
  return (
    <svg className="setup-wave" viewBox={`0 0 ${count * 7 - 3} 24`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const h = 6 + 18 * Math.abs(Math.sin(i * 1.3 + 0.5));
        return <rect key={i} className={i < played ? "on" : undefined} x={i * 7} y={(24 - h) / 2} width={4} height={h} rx={2} />;
      })}
    </svg>
  );
}

function draft(mode: Mode, language: SetupLanguage, current: Setup | null, score: Score | null): Setup {
  const same = current && current.mode === mode && languageKey(current.language) === languageKey(language);
  return same ? current : { mode, language, added: current?.added ?? [], removed: [], slow: score !== null && score.percent < VERY_FAST };
}

function timeText(size: number, speed: Props["speed"]): string | null {
  if (typeof speed !== "number") return null;
  const minutes = Math.round(downloadSeconds(size, speed) / 60);
  if (minutes < 1) return "under 1 min";
  return minutes < 60 ? `about ${minutes} min` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function runsOn(gpu: Gpu | null): string {
  if (!gpu) return "Checking…";
  if (!gpu.backend) return "CPU";
  const backend = gpu.backend === "metal" ? "Metal" : "Vulkan";
  const device = gpu.name ? `${backend} · ${gpu.name}` : backend;
  return gpu.backend === "vulkan" && !gpu.usable ? `${device}, CPU for Precise` : device;
}

function connection(speed: Props["speed"]): string {
  if (speed === "measuring") return "Measuring…";
  if (speed === "offline") return "Offline";
  const mbit = (speed * 8) / 1e6;
  return `${mbit >= 10 ? Math.round(mbit) : mbit.toFixed(1)} Mbit/s`;
}

export function SetupView(props: Props) {
  const { models, detections, languages, setup, speed, gpu, stats } = props;
  const [languageValue, setLanguageValue] = useState(languageKey(setup?.language ?? SEVERAL));
  const [clicked, setClicked] = useState<Mode | null>(null);
  const language = parseLanguage(languageValue);
  const sizes = Object.fromEntries(MODES.map((mode) => [mode, missingBytes(wanted(models, draft(mode, language, setup, props.score)), models, detections)])) as Record<Mode, number>;
  const precise = models.find((m) => (m.setups ?? []).includes("precise") && m.languages.includes("all"));
  const memory = (mode: Mode) => {
    const ids = wanted(models, draft(mode, language, setup, props.score));
    return Math.max(0, ...models.filter((m) => ids.includes(m.id)).map((m) => m.ram_gb));
  };
  const phoneBudget = FEATURES.mobile && stats ? stats.model_budget : null;
  const badge = recommend({ speed, gpu, memoryTotal: stats?.memory_total ?? null, preciseBytes: sizes.precise, preciseRamGb: precise?.ram_gb ?? 0, preciseModel: defaultModel(models, draft("precise", language, setup, props.score)), phoneBudget, essentialRamGb: memory("essential") });
  const selected = clicked ?? setup?.mode ?? badge;
  const next = selected ? draft(selected, language, setup, props.score) : null;
  const unchanged = next !== null && next === setup;
  const offline = speed === "offline";
  const blocked = !next || props.busy || unchanged || (offline && sizes[next.mode] > 0);
  const computer = [
    { label: "Runs on", value: runsOn(gpu) },
    FEATURES.mobile ? { label: "Memory for the app", value: stats ? gib(stats.memory_free) : "Checking…" } : { label: "Memory", value: stats ? wholeGb(stats.memory_total) : "Checking…" },
    { label: "Free disk", value: props.disk ? wholeGb(props.disk.free) : "Checking…" },
    { label: "Connection", value: connection(speed) },
  ];
  const score = props.score;
  const estimate = score?.speed === null;

  return (
    <section className={`setup ${props.variant}`} aria-label="Set up transcription">
      {props.variant === "page" && (
        <header className="setup-intro">
          <h2>Set up transcription</h2>
          <p className="muted">Choose once. Models download in the background and work offline from then on.</p>
        </header>
      )}
      <label className="setup-language" htmlFor="setup-language">
        <span className="label">Language you mostly transcribe</span>
        <Select id="setup-language" className="field-select" value={languageValue} onChange={setLanguageValue} label="Language you mostly transcribe" options={withSelectedLanguage(setupLanguages(models, languages), languageValue, languages)} disabled={props.busy} />
      </label>
      <dl className="setup-computer" aria-label="This computer">
        {computer.map((c) => (
          <div key={c.label}>
            <dt>{c.label}</dt>
            <dd title={c.value}>{c.value}</dd>
          </div>
        ))}
        {score && (
          <div className={`setup-score ${score.level}`}>
            <dt>Speed</dt>
            <dd>
              <span
                className={`speed-bars${estimate ? " estimate" : ""}`}
                role="meter"
                aria-label="Speed"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score.percent}
                aria-valuetext={`${score.word}, ${estimate ? "estimated" : "measured"}`}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={n <= score.bars ? "on" : undefined} style={{ ["--n" as string]: n }} />
                ))}
              </span>
              <Tooltip content={score.basis}>
                <strong className="speed-word" tabIndex={0}>
                  {estimate ? "≈ " : ""}
                  {score.word}
                </strong>
              </Tooltip>
            </dd>
          </div>
        )}
      </dl>
      <div className="setup-modes" role="radiogroup" aria-label="Setup">
        {MODES.map((mode) => {
          const size = sizes[mode];
          const time = size > 0 ? timeText(size, speed) : null;
          const slow = size > 0 && typeof speed === "number" ? downloadFit(downloadSeconds(size, speed)) : null;
          const ram = memory(mode);
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected === mode}
              className={`setup-mode${selected === mode ? " selected" : ""}`}
              onClick={() => setClicked(mode)}
              disabled={props.busy}
            >
              <span className="setup-head">
                <span className="setup-title">
                  <span className="setup-name">
                    <span className="setup-dot" aria-hidden="true" />
                    {MODE_NAMES[mode]}
                  </span>
                  <Wave mode={mode} />
                </span>
                <span className="setup-badges">
                  {badge === mode && (
                    <span className="status">
                      <span className="dot" aria-hidden="true" />
                      Recommended for this {DEVICE}
                    </span>
                  )}
                  {setup?.mode === mode && languageKey(setup.language) === languageValue && (
                    <span className="status">
                      <span className="dot" aria-hidden="true" />
                      Your setup
                    </span>
                  )}
                  {slow && slow.level !== "ok" && (
                    <span className="status" title={slow.tip ?? undefined}>
                      <span className={`dot ${slow.level}`} aria-hidden="true" />
                      Longer download
                    </span>
                  )}
                </span>
              </span>
              <span className="setup-pitch">{PITCH[mode]}</span>
              <span className="setup-facts">
                {FEATURES.speakers && (
                  <>
                    <span>Speakers</span>
                    <span>{MODE_DETECTION[mode] ? SPEAKERS[mode] : <span className="faint">{SPEAKERS[mode]}</span>}</span>
                  </>
                )}
                <span>Memory</span>
                <span>
                  <span className="data">{ram > 0 ? `≈ ${ram.toFixed(1)} GB RAM` : "–"}</span>
                  {phoneBudget !== null && ram > 0 && budgetFit(ram, phoneBudget).level === "high" && (
                    <span className="state">
                      <span className="dot high" aria-hidden="true" />
                      More than this phone allows
                    </span>
                  )}
                </span>
                <span>Download</span>
                <span className="data">{size === 0 ? "Installed" : [bytes(size), time].filter(Boolean).join(", ")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {offline && (
        <p className="callout danger setup-offline" role="alert">
          <span className="dot high" aria-hidden="true" />
          <span>
            Models cannot download right now: {props.speedError ?? "the model server did not answer"}.{" "}
            <button type="button" className="inline-link" onClick={props.onMeasureAgain}>
              Try again
            </button>
          </span>
        </p>
      )}
      {props.error && (
        <p className="callout danger" role="alert">
          <span className="dot high" aria-hidden="true" />
          <span>{props.error}</span>
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="primary" disabled={blocked} onClick={() => next && props.onApply(next)}>
          {props.variant === "page" ? "Download and start" : "Apply"}
        </button>
      </div>
      {props.leftoverBytes > 0 && (
        <p className="callout setup-leftovers">
          <span>
            <span className="data">{bytes(props.leftoverBytes)}</span> of models are no longer in your setup.{" "}
            <button type="button" className="inline-link" onClick={props.onRemoveLeftovers} disabled={props.busy}>
              Remove them
            </button>
          </span>
        </p>
      )}
      {props.onToggleDetails && (
        <button type="button" className={`setup-details-toggle${props.showDetails ? " open" : ""}`} aria-expanded={props.showDetails} onClick={props.onToggleDetails}>
          <ChevronDown className="chevron" size={20} />
          {props.showDetails ? "Hide single models" : "Show single models"}
        </button>
      )}
      {props.showDetails !== false && <div className="setup-details">{props.children(next)}</div>}
    </section>
  );
}
