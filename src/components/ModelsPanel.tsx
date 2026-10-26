import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { DETECTION } from "../lib/detection";
import { diskFit, downloadFit, downloadSeconds, failedFit, ramFit, type Rating } from "../lib/fit";
import { bytes, capitalize, fileName, folderOf } from "../lib/format";
import { DETECTION_IDS, installed as isInstalled, MODE_NAMES, sizeOf, wanted, type Setup } from "../lib/setup";
import type { DiskSpace, DownloadProgress, ModelStatus, SpeakerBackend, SpeakerDetection, Stats } from "../lib/types";
import { Check, ChevronDown, Close, Info, LinkIcon, Pencil, Trash, Unlink } from "./icons";
import { Tooltip } from "./Tooltip";

export type DetailsProps = {
  focus: "detection" | null;
  models: ModelStatus[];
  detections: SpeakerDetection[];
  downloads: Record<string, DownloadProgress>;
  failed: Record<string, string>;
  setup: Setup | null;
  selected: Setup | null;
  stats: Stats | null;
  disk: DiskSpace | null;
  speed: number | "measuring" | "offline";
  busy: boolean;
  folder: string;
  onDownload: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onAddFile: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUnlink: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onShowFolder: () => void;
  onOpenUrl: (url: string) => void;
  onDownloadDetection: (backend: SpeakerBackend) => void;
  onCancelDetection: (backend: SpeakerBackend) => void;
  onRemoveDetection: (backend: SpeakerBackend) => void;
  onLeaveSetup: (id: string) => void;
  /** Members a newer model list added to the setup, waiting for the user to agree. */
  fresh: string[];
  onAcceptFresh: () => void;
};

const LANGUAGE_NAMES: Record<string, string> = {
  th: "Thai",
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  ja: "Japanese",
  zh: "Chinese",
};

export function languagesOf(m: ModelStatus): string {
  if (m.language_name) return m.language_name;
  if (m.languages.includes("all")) return "All languages";
  return m.languages.map((l) => LANGUAGE_NAMES[l] ?? capitalize(l)).join(", ");
}

export function menuLabel(m: ModelStatus): string {
  const notes = [m.custom && "custom", m.too_heavy && "failed here"].filter(Boolean);
  return notes.length ? `${m.name} (${notes.join(", ")})` : m.name;
}

function repoOf(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?huggingface\.co\//, "").replace(/^https?:\/\//, "");
}

function shortDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function critical(rating: Rating | null): Rating | null {
  return rating?.level === "ok" ? null : rating;
}

function Chip({ rating, children }: { rating: Rating | null; children: ReactNode }) {
  const className = `chip${rating ? ` ${rating.level}` : ""}`;
  if (!rating?.tip) return <span className={className}>{children}</span>;
  return (
    <Tooltip content={rating.tip}>
      <span className={className} tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  );
}

type Group = "all" | "detection" | "custom";

/** Models under one heading per language: all languages first, then the languages of the setup, then the rest. */
function byLanguage(models: ModelStatus[], setupIds: string[]): [string, ModelStatus[]][] {
  const sections = new Map<string, ModelStatus[]>();
  for (const m of models) {
    const name = languagesOf(m);
    sections.set(name, [...(sections.get(name) ?? []), m]);
  }
  const rank = ([name, list]: [string, ModelStatus[]]) => (name === "All languages" ? 0 : list.some((m) => setupIds.includes(m.id)) ? 1 : 2);
  return [...sections].sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]));
}

export function ModelDetails(props: DetailsProps) {
  const { models, detections, downloads, failed, setup, stats, disk, speed, busy, folder, onDownload, onCancelDownload, onAddFile, onDelete, onShowFolder, onOpenUrl } = props;
  const [open, setOpen] = useState<Record<Group, boolean>>({ all: false, detection: props.focus === "detection", custom: true });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const detectionGroup = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (props.focus === "detection") detectionGroup.current?.scrollIntoView({ block: "center" });
  }, [props.focus]);
  useLayoutEffect(() => {
    if (renaming) nameInput.current?.select();
  }, [renaming]);

  const listed = models.filter((m) => !m.custom);
  const custom = models.filter((m) => m.custom);
  const ids = setup ? wanted(models, setup) : [];
  const selected = props.selected && props.selected !== setup ? props.selected : null;
  const next = selected ? wanted(models, selected) : [];
  const membership = (id: string, done: boolean) =>
    selected ? (
      <>
        {next.includes(id) && <span className="chip recommended">{done ? `In ${MODE_NAMES[selected.mode]}` : `Downloads with ${MODE_NAMES[selected.mode]}`}</span>}
        {ids.includes(id) && <span className="chip">In your setup</span>}
      </>
    ) : (
      ids.includes(id) && <span className="chip recommended">In your setup</span>
    );
  const cardClass = (id: string, done: boolean) => `model-card${done ? " installed" : next.includes(id) ? " selected" : ""}`;
  const seconds = (size: number) => (typeof speed === "number" ? downloadSeconds(size, speed) : null);

  const finishRename = (save: boolean) => {
    const id = renaming;
    setRenaming(null);
    const name = draft.replace(/\s+/g, " ").trim();
    const current = models.find((m) => m.id === id);
    if (save && id && current && name && name !== current.name) props.onRename(id, name);
  };

  const progress = (id: string, onCancel: () => void) => {
    const dl = downloads[id];
    const percent = dl?.total ? Math.round((dl.bytes / dl.total) * 100) : 0;
    return (
      <span className="model-action">
        <span className="bar small">
          <span className="fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="muted tabular">{percent}%</span>
        <button type="button" className="icon-button small" onClick={onCancel} aria-label="Cancel the download">
          <Close size={15} />
        </button>
      </span>
    );
  };

  const setupRow = (id: string) => {
    const backend = (Object.keys(DETECTION_IDS) as SpeakerBackend[]).find((b) => DETECTION_IDS[b] === id);
    const m = models.find((x) => x.id === id);
    if (!backend && !m) return null;
    const purpose = backend ? DETECTION[backend].name : `Transcription, ${languagesOf(m!).replace(/^All/, "all")}`;
    const file = backend ? (backend === "sherpa" ? "sherpa-onnx 1.13.8 · pyannote, CAM++" : "Nemotron 3 Diarization · f16 GGUF") : `${fileName(m!.file)} · ${m!.label ?? [m!.architecture, m!.quantization].filter(Boolean).join(", ")}`;
    const done = isInstalled(id, models, detections);
    const dl = downloads[id];
    const status = props.fresh.includes(id) ? (
      <span className="setup-status">New</span>
    ) : done ? (
      <span className="setup-status ok">
        <Check size={13} /> Installed
      </span>
    ) : dl ? (
      <span className="setup-status tabular">Downloading {dl.total ? Math.round((dl.bytes / dl.total) * 100) : 0}%</span>
    ) : failed[id] ? (
      <Tooltip content={failed[id]}>
        <span className="setup-status problem-text" tabIndex={0}>
          Failed
        </span>
      </Tooltip>
    ) : (
      <span className="setup-status faint">Waiting</span>
    );
    return (
      <li key={id} className="setup-row">
        <span>{purpose}</span>
        <span className="mono" title={m?.path ?? m?.file ?? undefined}>
          {file}
        </span>
        <span className="tabular">{bytes(sizeOf(id, models, detections))}</span>
        {status}
        <Tooltip content={done ? "Take it out of the setup and delete it from the computer" : "Take it out of the setup"}>
          <button type="button" className="icon-button small" onClick={() => props.onLeaveSetup(id)} disabled={busy} aria-label={`Take ${purpose} out of the setup`}>
            {done ? <Trash size={15} /> : <Close size={15} />}
          </button>
        </Tooltip>
      </li>
    );
  };

  const customCard = (m: ModelStatus) => {
    const ram = stats && m.installed ? ramFit(m.ram_gb, stats.memory_total) : null;
    return (
      <li key={m.id} className={`model-card${m.installed ? " installed" : ""}`}>
        <div className="model-top">
          <span className="model-title">
            {renaming === m.id ? (
              <input
                ref={nameInput}
                className="model-name-editor"
                value={draft}
                maxLength={60}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(true)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter") finishRename(true);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    finishRename(false);
                  }
                }}
                aria-label="Name of this model"
              />
            ) : (
              <>
                <strong>{m.name}</strong>
                {m.linked && (
                  <button
                    type="button"
                    className="icon-button tiny"
                    onClick={() => {
                      setDraft(m.name);
                      setRenaming(m.id);
                    }}
                    aria-label={`Rename ${m.name}`}
                    title="Rename"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </>
            )}
          </span>
          <span className="model-action">
            {m.linked ? (
              <Tooltip content="Take it off the list. The file stays where it is.">
                <button type="button" className="icon-button small" onClick={() => props.onUnlink(m.id)} disabled={busy} aria-label={`Unlink ${m.name}`}>
                  <Unlink size={15} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="Delete this copy from the models folder">
                <button type="button" className="icon-button small" onClick={() => onDelete(m.id)} disabled={busy} aria-label={`Delete ${m.name}`}>
                  <Trash size={15} />
                </button>
              </Tooltip>
            )}
          </span>
        </div>
        <p className="model-about" title={m.file}>
          {!m.installed ? <span className="problem-text">Not found at {m.file}</span> : m.linked ? `Used from ${folderOf(m.file)}` : "Copied into the models folder"}
        </p>
        <div className="chips">
          <span className="chip custom">Custom</span>
          {m.too_heavy && <Chip rating={failedFit(m.too_heavy)}>Failed on this computer</Chip>}
          {m.label && <span className="chip">{m.label}</span>}
          {m.installed && <span className="chip">{m.languages.includes("all") ? "Multilingual" : "English only"}</span>}
          {m.installed && <span className="chip">{bytes(m.size_bytes)} size</span>}
          {ram && <Chip rating={ram}>≈ {m.ram_gb.toFixed(1)} GB RAM</Chip>}
        </div>
      </li>
    );
  };

  const card = (m: ModelStatus) => {
    const ram = stats ? ramFit(m.ram_gb, stats.memory_total) : null;
    const space = !m.installed && disk ? diskFit(m.size_bytes, disk.free, disk.minimum, disk.reserve) : null;
    const time = seconds(m.size_bytes);
    return (
      <li key={m.id} className={cardClass(m.id, m.installed)}>
        <div className="model-top">
          <span className="model-title">
            <strong>{m.name}</strong>
            {m.source && (
              <Tooltip
                content={
                  <>
                    <strong className="tip-note">{repoOf(m.source)}</strong>
                    <span>{m.license ? `${m.license} license. ` : ""}Opens the model page.</span>
                  </>
                }
              >
                <button type="button" className="icon-button tiny" onClick={() => onOpenUrl(m.source!)} aria-label={`Open the page of ${m.name}`}>
                  <LinkIcon size={14} />
                </button>
              </Tooltip>
            )}
          </span>
          {m.installed ? (
            <span className="model-action">
              <span className="pill ok">
                <Check size={13} /> Installed
              </span>
              <Tooltip content="Delete this model from the computer">
                <button type="button" className="icon-button small" onClick={() => onDelete(m.id)} disabled={busy} aria-label={`Delete ${m.name}`}>
                  <Trash size={15} />
                </button>
              </Tooltip>
            </span>
          ) : downloads[m.id] ? (
            progress(m.id, () => onCancelDownload(m.id))
          ) : m.url ? (
            <button type="button" className="primary small" onClick={() => onDownload(m.id)} disabled={space?.level === "high"}>
              Download
            </button>
          ) : (
            <Tooltip content={`Choose ${m.file} (${bytes(m.size_bytes)}) on this computer.`}>
              <button type="button" className="primary small" onClick={() => onAddFile(m.id)} disabled={space?.level === "high"}>
                Add file…
              </button>
            </Tooltip>
          )}
        </div>
        <p className="model-about">{m.recommended}</p>
        <div className="chips">
          {m.too_heavy && <Chip rating={failedFit(m.too_heavy)}>Failed on this computer</Chip>}
          {membership(m.id, m.installed)}
          {m.architecture && <span className="chip">{[m.architecture, m.quantization].filter(Boolean).join(", ")}</span>}
          <Chip rating={critical(space)}>{bytes(m.size_bytes)} size</Chip>
          {ram && <Chip rating={ram}>{m.ram_gb.toFixed(1)} GB RAM</Chip>}
          {m.url && !m.installed && (
            <Chip rating={time !== null ? critical(downloadFit(time)) : null}>{time !== null ? `${shortDuration(time)} download` : speed === "offline" ? "No connection" : "Measuring speed…"}</Chip>
          )}
        </div>
      </li>
    );
  };

  const detectionCard = (detection: SpeakerDetection) => {
    if (!detection.available) return null;
    const { backend } = detection;
    const info = DETECTION[backend];
    const id = DETECTION_IDS[backend];
    const space = !detection.installed && disk ? diskFit(detection.download_bytes * 2, disk.free, disk.minimum, disk.reserve) : null;
    const time = seconds(detection.download_bytes);
    return (
      <li key={id} className={cardClass(id, detection.installed)}>
        <div className="model-top">
          <span className="model-title">
            <strong>{info.name}</strong>
            <Tooltip
              content={
                <>
                  <strong className="tip-note">{repoOf(info.source)}</strong>
                  <span>{info.credit} Opens the project page.</span>
                </>
              }
            >
              <button type="button" className="icon-button tiny" onClick={() => onOpenUrl(info.source)} aria-label={`Open the page of ${info.name}`}>
                <LinkIcon size={14} />
              </button>
            </Tooltip>
          </span>
          {detection.installed ? (
            <span className="model-action">
              <span className="pill ok">
                <Check size={13} /> Installed
              </span>
              <Tooltip content="Delete this speaker detection from the computer">
                <button type="button" className="icon-button small" onClick={() => props.onRemoveDetection(backend)} disabled={busy} aria-label={`Delete ${info.name}`}>
                  <Trash size={15} />
                </button>
              </Tooltip>
            </span>
          ) : downloads[id] || detection.downloading ? (
            progress(id, () => props.onCancelDetection(backend))
          ) : (
            <button type="button" className="primary small" onClick={() => props.onDownloadDetection(backend)} disabled={space?.level === "high"}>
              Download
            </button>
          )}
        </div>
        <p className="model-about">
          {backend === "sherpa" ? "Names who speaks when in a recording with one audio track. Small and quick, misses short replies." : "Names who speaks when, including short replies, for up to eight people. Runs offline."}
        </p>
        <div className="chips">
          {membership(id, detection.installed)}
          <span className="chip">Any language</span>
          <Chip rating={critical(space)}>{bytes(detection.installed ? detection.disk_bytes : detection.download_bytes)} size</Chip>
          {!detection.installed && (
            <Chip rating={time !== null ? critical(downloadFit(time)) : null}>{time !== null ? `${shortDuration(time)} download` : speed === "offline" ? "No connection" : "Measuring speed…"}</Chip>
          )}
        </div>
      </li>
    );
  };

  const group = (id: Group, title: string, count: number, body: ReactNode, ref?: Ref<HTMLDivElement>) =>
    count > 0 && (
      <div className={`group${open[id] ? " open" : ""}`} ref={ref}>
        <button type="button" className="group-head" aria-expanded={open[id]} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
          <ChevronDown className="chevron" size={16} />
          <span>{title}</span>
          <span className="count">{count}</span>
        </button>
        {open[id] && body}
      </div>
    );

  const sections = byLanguage(listed, [...ids, ...next]);
  const available = detections.filter((d) => d.available);

  return (
    <div className="details">
      {setup && (
        <div className="setup-list">
          <h3>In your setup</h3>
          {props.fresh.length > 0 && (
            <p className="setup-news">
              <span>{props.fresh.length === 1 ? "A new model joined" : "New models joined"} your setup with this version of the app.</span>
              <button type="button" className="primary small" onClick={props.onAcceptFresh} disabled={busy}>
                Download {bytes(props.fresh.reduce((sum, id) => sum + sizeOf(id, models, detections), 0))}
              </button>
            </p>
          )}
          <ul>{ids.map(setupRow)}</ul>
        </div>
      )}
      {group(
        "all",
        "Transcription models",
        listed.length,
        sections.map(([language, list]) => (
          <section key={language} className="model-section">
            <h4>
              {language}
              <span className="count">{list.length}</span>
            </h4>
            <ul className="model-grid">{list.map(card)}</ul>
          </section>
        )),
      )}
      {group("detection", "Speaker detection", available.length, <ul className="model-grid">{available.map(detectionCard)}</ul>, detectionGroup)}
      {group("custom", "Custom models", custom.length, <ul className="model-grid">{custom.map(customCard)}</ul>)}
      <div className="details-actions">
        <Tooltip content="Only whisper.cpp files named ggml-….bin work. PyTorch, CTranslate2 and ONNX files from Hugging Face do not. The file is used where it lies, not copied.">
          <button type="button" onClick={() => onAddFile(null)}>
            Add any model file…
            <Info size={15} className="button-info" />
          </button>
        </Tooltip>
        <button type="button" className="ghost" onClick={onShowFolder} title={folder}>
          Show models folder
        </button>
      </div>
    </div>
  );
}

export function ModelsDialog({ error, onClose, children, footer }: { error: string | null; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="models-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="models-title">Models</h2>
            <p className="muted">Choose a setup once. Models download in the background and work offline from then on.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body">
          {error && (
            <p className="problem" role="alert">
              {error}
            </p>
          )}
          {children}
          {footer}
        </div>
      </section>
    </div>
  );
}
