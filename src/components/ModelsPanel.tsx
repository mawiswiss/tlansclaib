import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { diskFit, downloadFit, downloadSeconds, ramFit, type Rating } from "../lib/fit";
import { DETECTION_ID, DETECTION_SOURCE, SHERPA_ONNX } from "../lib/detection";
import { bytes, capitalize, folderOf } from "../lib/format";
import type { DiskSpace, DownloadProgress, ModelStatus, SpeakerDetection, Stats } from "../lib/types";
import { Check, ChevronDown, Close, Info, LinkIcon, Pencil, Trash, Unlink } from "./icons";
import { Tooltip } from "./Tooltip";

type Props = {
  focus?: "detection" | null;
  models: ModelStatus[];
  downloads: Record<string, DownloadProgress>;
  stats: Stats | null;
  disk: DiskSpace | null;
  speed: number | "measuring" | "offline";
  busy: boolean;
  error: string | null;
  folder: string;
  onDownload: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onAddFile: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUnlink: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onShowFolder: () => void;
  onOpenUrl: (url: string) => void;
  detection: SpeakerDetection | null;
  onDownloadDetection: () => void;
  onCancelDetection: () => void;
  onRemoveDetection: () => void;
  onClose: () => void;
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

function languagesOf(m: ModelStatus): string {
  if (m.language_name) return m.language_name;
  if (m.languages.includes("all")) return "All languages";
  return m.languages.map((l) => LANGUAGE_NAMES[l] ?? capitalize(l)).join(", ");
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

type Group = "main" | "single" | "more" | "custom";

export function ModelsPanel(props: Props) {
  const { models, downloads, stats, disk, speed, busy, error, folder, onDownload, onCancelDownload, onAddFile, onDelete, onShowFolder, onOpenUrl, onClose } = props;
  const [open, setOpen] = useState<Record<Group, boolean>>({ main: true, single: false, more: false, custom: true });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const optional = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    if (props.focus === "detection") optional.current?.scrollIntoView({ block: "center" });
  }, [props.focus]);
  const listed = models.filter((m) => !m.custom);
  const custom = models.filter((m) => m.custom);
  const mac = /Mac/.test(navigator.userAgent);
  const ramGb = stats ? stats.memory_total / 2 ** 30 : 0;
  const recommended: Record<string, { label: string; why: string }> = {
    "large-v3-turbo-q5_0": { label: "best balance", why: "Fast and accurate for most recordings, and a small download" },
  };
  if (mac && ramGb >= 16) {
    recommended["large-v3-q5_0"] = {
      label: "best quality",
      why: "The most accurate model for its download size. This computer has the memory and graphics to run it at a good pace",
    };
  }
  const main = listed.filter((m) => m.featured || m.installed || downloads[m.id] || recommended[m.id]);
  const single = listed.filter((m) => !main.includes(m) && !m.languages.includes("all"));
  const more = listed.filter((m) => !main.includes(m) && !single.includes(m));

  useLayoutEffect(() => {
    if (renaming) nameInput.current?.select();
  }, [renaming]);

  const finishRename = (save: boolean) => {
    const id = renaming;
    setRenaming(null);
    const name = draft.replace(/\s+/g, " ").trim();
    const current = models.find((m) => m.id === id);
    if (save && id && current && name && name !== current.name) props.onRename(id, name);
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
          {!m.installed ? (
            <span className="problem-text">Not found at {m.file}</span>
          ) : m.linked ? (
            `Used from ${folderOf(m.file)}`
          ) : (
            "Copied into the models folder"
          )}
        </p>
        <div className="chips">
          <span className="chip custom">Custom</span>
          {m.label && <span className="chip">{m.label}</span>}
          {m.installed && <span className="chip">{m.languages.includes("all") ? "Multilingual" : "English only"}</span>}
          {m.installed && <span className="chip">{bytes(m.size_bytes)} size</span>}
          {ram && <Chip rating={ram}>≈ {m.ram_gb.toFixed(1)} GB RAM</Chip>}
        </div>
      </li>
    );
  };

  const card = (m: ModelStatus) => {
    const dl = downloads[m.id];
    const ram = stats ? ramFit(m.ram_gb, stats.memory_total) : null;
    const space = !m.installed && disk ? diskFit(m.size_bytes, disk.free, disk.minimum, disk.reserve) : null;
    const fits = space?.level !== "high";
    const seconds = typeof speed === "number" ? downloadSeconds(m.size_bytes, speed) : null;
    const percent = dl?.total ? Math.round((dl.bytes / dl.total) * 100) : 0;
    return (
      <li key={m.id} className={`model-card${m.installed ? " installed" : ""}`}>
        <div className="model-top">
          <span className="model-title">
            <strong>{m.title ?? m.name}</strong>
            {m.source && (
              <Tooltip
                content={
                  <>
                    <strong className="tip-note">{repoOf(m.source)}</strong>
                    <span>
                      {m.license ? `${m.license} license. ` : ""}Opens the model page.
                    </span>
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
          ) : dl ? (
            <span className="model-action">
              <span className="bar small">
                <span className="fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="muted tabular">{percent}%</span>
              <button type="button" className="icon-button small" onClick={() => onCancelDownload(m.id)} aria-label="Cancel the download">
                <Close size={15} />
              </button>
            </span>
          ) : m.url ? (
            <button type="button" className="primary small" onClick={() => onDownload(m.id)} disabled={!fits}>
              Download
            </button>
          ) : (
            <Tooltip content={`Choose ${m.file} (${bytes(m.size_bytes)}) on this computer.`}>
              <button type="button" className="primary small" onClick={() => onAddFile(m.id)} disabled={!fits}>
                Add file…
              </button>
            </Tooltip>
          )}
        </div>
        <p className="model-about">{m.recommended}</p>
        <div className="chips">
          {recommended[m.id] && (
            <Tooltip
              content={
                <>
                  <strong className="tip-note">Recommended, {recommended[m.id].label}</strong>
                  <span>{recommended[m.id].why}.</span>
                </>
              }
            >
              <span className="chip recommended" tabIndex={0}>
                Recommended
              </span>
            </Tooltip>
          )}
          <span className="chip">{languagesOf(m)}</span>
          <Chip rating={critical(space)}>{bytes(m.size_bytes)} size</Chip>
          {ram && <Chip rating={ram}>{m.ram_gb.toFixed(1)} GB RAM</Chip>}
          {m.url && !m.installed && (
            <Chip rating={seconds !== null ? critical(downloadFit(seconds)) : null}>
              {seconds !== null ? `${shortDuration(seconds)} download` : speed === "offline" ? "No connection" : "Measuring speed…"}
            </Chip>
          )}
        </div>
      </li>
    );
  };

  const detection = props.detection;
  const detectionCard = () => {
    if (!detection?.available) return null;
    const dl = downloads[DETECTION_ID];
    const percent = dl?.total ? Math.round((dl.bytes / dl.total) * 100) : 0;
    const space = !detection.installed && disk ? diskFit(detection.download_bytes * 2, disk.free, disk.minimum, disk.reserve) : null;
    const seconds = typeof speed === "number" ? downloadSeconds(detection.download_bytes, speed) : null;
    return (
      <li
        key={DETECTION_ID}
        ref={optional}
        className={`model-card${detection.installed ? " installed" : ""}${props.focus === "detection" ? " focused" : ""}`}
      >
        <div className="model-top">
          <span className="model-title">
            <strong>Speaker detection</strong>
            <Tooltip
              content={
                <>
                  <strong className="tip-note">sherpa-onnx {SHERPA_ONNX}</strong>
                  <span>pyannote segmentation (MIT) and 3D-Speaker CAM++ (Apache 2.0). Opens the project page.</span>
                </>
              }
            >
              <button type="button" className="icon-button tiny" onClick={() => onOpenUrl(DETECTION_SOURCE)} aria-label="Open the page of sherpa-onnx">
                <LinkIcon size={14} />
              </button>
            </Tooltip>
          </span>
          {detection.installed ? (
            <span className="model-action">
              <span className="pill ok">
                <Check size={13} /> Installed
              </span>
              <Tooltip content="Delete speaker detection from the computer">
                <button type="button" className="icon-button small" onClick={props.onRemoveDetection} disabled={busy} aria-label="Delete speaker detection">
                  <Trash size={15} />
                </button>
              </Tooltip>
            </span>
          ) : dl || detection.downloading ? (
            <span className="model-action">
              <span className="bar small">
                <span className="fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="muted tabular">{percent}%</span>
              <button type="button" className="icon-button small" onClick={props.onCancelDetection} aria-label="Cancel the download">
                <Close size={15} />
              </button>
            </span>
          ) : (
            <button type="button" className="primary small" onClick={props.onDownloadDetection} disabled={space?.level === "high"}>
              Download
            </button>
          )}
        </div>
        <p className="model-about">
          Names who speaks when in a recording with one audio track, like a meeting room. Runs offline.
        </p>
        <div className="chips">
          <Tooltip content="Who said what, in recordings with one audio track.">
            <span className="chip recommended" tabIndex={0}>
              Recommended
            </span>
          </Tooltip>
          <span className="chip">Any language</span>
          <Chip rating={critical(space)}>
            {bytes(detection.installed ? detection.disk_bytes : detection.download_bytes)} size
          </Chip>
          {!detection.installed && (
            <Chip rating={seconds !== null ? critical(downloadFit(seconds)) : null}>
              {seconds !== null ? `${shortDuration(seconds)} download` : speed === "offline" ? "No connection" : "Measuring speed…"}
            </Chip>
          )}
        </div>
      </li>
    );
  };

  const group = (id: Group, title: string, list: ModelStatus[], render = card, lead: ReactNode = null) =>
    (list.length > 0 || lead) && (
      <div className={`group${open[id] ? " open" : ""}`}>
        <button type="button" className="group-head" aria-expanded={open[id]} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
          <ChevronDown className="chevron" size={16} />
          <span>{title}</span>
          <span className="count">{list.length + (lead ? 1 : 0)}</span>
        </button>
        {open[id] && (
          <ul className="model-grid">
            {lead}
            {list.map(render)}
          </ul>
        )}
      </div>
    );

  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="models-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="models-title">Models</h2>
            <p className="muted">A model turns speech into text. Install one once and it works offline from then on.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body">
          {error && <p className="problem">{error}</p>}
          {group("main", "Recommended and installed", main, card, detectionCard())}
          {group("single", "For one language", single)}
          {group("more", "More models", more)}
          {group("custom", "Custom models", custom, customCard)}
        </div>
        <footer className="modal-foot">
          <Tooltip content="Only whisper.cpp files named ggml-….bin work. PyTorch, CTranslate2 and ONNX files from Hugging Face do not. The file is used where it lies, not copied.">
            <button type="button" onClick={() => onAddFile(null)}>
              Add any model file…
              <Info size={15} className="button-info" />
            </button>
          </Tooltip>
          <button type="button" className="ghost" onClick={onShowFolder} title={folder}>
            Show models folder
          </button>
        </footer>
      </section>
    </div>
  );
}
