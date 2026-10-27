import { useState, type ReactNode } from "react";
import { downloadFit, downloadSeconds, type Score } from "../lib/fit";
import { bytes, wholeGb } from "../lib/format";
import { defaultModel, languageKey, missingBytes, MODE_DETECTION, MODE_NAMES, MODES, parseLanguage, recommend, SEVERAL, setupLanguages, wanted, type Mode, type Setup, type SetupLanguage } from "../lib/setup";
import type { DiskSpace, Gpu, Language, ModelStatus, SpeakerDetection, Stats } from "../lib/types";
import { ChevronDown } from "./icons";
import { Select } from "./Select";
import { Meter } from "./SystemBar";

type Props = {
  variant: "page" | "dialog";
  models: ModelStatus[];
  detections: SpeakerDetection[];
  languages: Language[];
  setup: Setup | null;
  speed: number | "measuring" | "offline";
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

const PITCH: Record<Mode, string> = {
  precise: "Most accurate results, with the biggest models.",
  essential: "Mid-sized models for older computers or slower internet.",
  minimal: "One small model and basic speaker detection. For when the others don't run.",
};

const SPEAKERS: Record<Mode, string> = { precise: "Better detection", essential: "Better detection", minimal: "Basic detection" };

const BARS: Record<Mode, number> = { precise: 30, essential: 16, minimal: 8 };

function Wave({ mode }: { mode: Mode }) {
  const count = BARS[mode];
  const step = 120 / count;
  return (
    <svg className="setup-wave" viewBox="0 0 120 60" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const t = (i + 0.5) / count;
        const h = 6 + 54 * Math.abs(0.6 * Math.sin(t * Math.PI * 3.1 + 0.4) + 0.4 * Math.sin(t * Math.PI * 7.3)) * Math.sin(t * Math.PI);
        return <rect key={i} x={i * step + (step - 2.4) / 2} y={(60 - h) / 2} width={2.4} height={h} rx={1.2} />;
      })}
    </svg>
  );
}

function draft(mode: Mode, language: SetupLanguage, current: Setup | null): Setup {
  const same = current && current.mode === mode && languageKey(current.language) === languageKey(language);
  return same ? current : { mode, language, added: current?.added ?? [], removed: [] };
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
  return `${speed >= 1e7 ? Math.round(speed / 1e6) : (speed / 1e6).toFixed(1)} MB/s`;
}

export function SetupView(props: Props) {
  const { models, detections, languages, setup, speed, gpu, stats } = props;
  const [languageValue, setLanguageValue] = useState(languageKey(setup?.language ?? SEVERAL));
  const [clicked, setClicked] = useState<Mode | null>(null);
  const language = parseLanguage(languageValue);
  const sizes = Object.fromEntries(MODES.map((mode) => [mode, missingBytes(wanted(models, draft(mode, language, setup)), models, detections)])) as Record<Mode, number>;
  const precise = models.find((m) => (m.setups ?? []).includes("precise") && m.languages.includes("all"));
  const badge = recommend({ speed, gpu, memoryTotal: stats?.memory_total ?? null, preciseBytes: sizes.precise, preciseRamGb: precise?.ram_gb ?? 0, preciseModel: defaultModel(models, draft("precise", language, setup)) });
  const selected = clicked ?? setup?.mode ?? badge;
  const next = selected ? draft(selected, language, setup) : null;
  const unchanged = next !== null && next === setup;
  const offline = speed === "offline";
  const blocked = !next || props.busy || unchanged || (offline && sizes[next.mode] > 0);
  const memory = (mode: Mode) => {
    const ids = wanted(models, draft(mode, language, setup));
    return Math.max(0, ...models.filter((m) => ids.includes(m.id)).map((m) => m.ram_gb));
  };
  const computer = [
    { label: "Runs on", value: runsOn(gpu) },
    { label: "Memory", value: stats ? wholeGb(stats.memory_total) : "Checking…" },
    { label: "Free disk", value: props.disk ? wholeGb(props.disk.free) : "Checking…" },
    { label: "Connection", value: connection(speed) },
  ];

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
        <Select id="setup-language" className="field-select" value={languageValue} onChange={setLanguageValue} label="Language you mostly transcribe" options={setupLanguages(models, languages)} disabled={props.busy} />
      </label>
      <dl className="setup-computer" aria-label="This computer">
        {computer.map((c) => (
          <div key={c.label}>
            <dt>{c.label}</dt>
            <dd title={c.value}>{c.value}</dd>
          </div>
        ))}
        {props.score && (
          <div className="setup-score">
            <dt>Rating</dt>
            <dd>
              <Meter value={props.score.percent / 100} state={props.score.level} />
              <strong className="tabular">{props.score.percent}%</strong>
              <span className="muted">{props.score.basis}</span>
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
                <span className="setup-name">
                  <span className="setup-dot" aria-hidden="true" />
                  {MODE_NAMES[mode]}
                </span>
                <span className="setup-badges">
                  {badge === mode && <span className="chip recommended">Recommended</span>}
                  {setup?.mode === mode && languageKey(setup.language) === languageValue && <span className="chip ok">Your setup</span>}
                  {slow && slow.level !== "ok" && (
                    <span className={`chip ${slow.level}`} title={slow.tip ?? undefined}>
                      Longer download
                    </span>
                  )}
                </span>
                <Wave mode={mode} />
              </span>
              <span className="setup-pitch">{PITCH[mode]}</span>
              <span className="setup-facts">
                <span>Speakers</span>
                <span>{MODE_DETECTION[mode] ? SPEAKERS[mode] : <span className="faint">{SPEAKERS[mode]}</span>}</span>
                <span>Memory</span>
                <span>{ram > 0 ? `≈ ${ram.toFixed(1)} GB RAM` : "–"}</span>
                <span>Download</span>
                <span>{size === 0 ? "Installed" : [bytes(size), time].filter(Boolean).join(", ")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {offline && (
        <p className="problem setup-offline" role="alert">
          No connection. Connect to the internet to download the models.{" "}
          <button type="button" className="inline-link" onClick={props.onMeasureAgain}>
            Try again
          </button>
        </p>
      )}
      {props.error && (
        <p className="problem" role="alert">
          {props.error}
        </p>
      )}
      <div className="setup-actions">
        <button type="button" className="primary" disabled={blocked} onClick={() => next && props.onApply(next)}>
          {props.variant === "page" ? "Download and start" : "Apply"}
        </button>
      </div>
      {props.leftoverBytes > 0 && (
        <p className="note setup-leftovers">
          {bytes(props.leftoverBytes)} of models are no longer in your setup.{" "}
          <button type="button" className="inline-link" onClick={props.onRemoveLeftovers} disabled={props.busy}>
            Remove them
          </button>
        </p>
      )}
      {props.onToggleDetails && (
        <button type="button" className={`setup-details-toggle${props.showDetails ? " open" : ""}`} aria-expanded={props.showDetails} onClick={props.onToggleDetails}>
          <ChevronDown className="chevron" size={16} />
          {props.showDetails ? "Hide single models" : "Show single models"}
        </button>
      )}
      {props.showDetails !== false && <div className="setup-details">{props.children(next)}</div>}
    </section>
  );
}
