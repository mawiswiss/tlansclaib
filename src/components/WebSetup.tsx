import { DESKTOP } from "../lib/about";
import { bytes } from "../lib/format";
import type { DownloadProgress, ModelStatus } from "../lib/types";
import { Alert, Check, Close, Download, Lock, Monitor, Trash } from "./icons";

type Props = {
  variant: "page" | "dialog";
  model: ModelStatus | null;
  progress: DownloadProgress | null;
  error: string | null;
  problem: string | null;
  busy: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenUrl: (url: string) => void;
  onCompare: () => void;
};

const LIMITS = [
  { text: "The first 10 minutes of each recording", has: true },
  { text: "One model for about 100 languages", has: true },
  { text: "Speaker detection", has: false },
];

const DESKTOP_PITCH = "Lite runs a compact model with more mistakes. The desktop app transcribes full recordings and names the speakers.";

export function WebSetup({ variant, model, progress, error, problem, busy, onDownload, onCancel, onDelete, onOpenUrl, onCompare }: Props) {
  const desktop = (primary: boolean) => (
    <button type="button" className={primary ? "primary" : undefined} onClick={() => onOpenUrl(DESKTOP)}>
      <Monitor size={15} /> Get the desktop app
    </button>
  );
  if (problem) {
    return (
      <section className="notice">
        <div className="notice-card">
          <span className="glyph problem-glyph">
            <Alert size={28} />
          </span>
          <h2>This browser cannot run tlansclaib Lite</h2>
          <p>tlansclaib Lite transcribes audio and video to text or subtitles on your own computer, in about 100 languages, and never uploads the recording.</p>
          <p role="alert">{problem} The desktop app for Mac and Windows runs on any recent computer.</p>
          <div className="actions">{desktop(true)}</div>
        </div>
      </section>
    );
  }
  const percent = progress?.total ? Math.round((progress.bytes / progress.total) * 100) : 0;
  const download = progress && (
    <div className="web-download" role="status">
      <span className="bar" aria-hidden="true">
        <span className="fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="muted">
        Downloading {bytes(progress.bytes)} of {bytes(progress.total)}, {percent}%
      </span>
      <button type="button" className="small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
  const problemText = error && (
    <p className="problem" role="alert">
      {error}
    </p>
  );
  const limits = (
    <ul className="feature-list web-limits">
      {LIMITS.map((l) => (
        <li key={l.text} className={l.has ? undefined : "missing"}>
          {l.has ? <Check size={15} strokeWidth={2.2} /> : <Close size={15} strokeWidth={2.2} />}
          <span>{l.has ? l.text : <><span className="sr-only">Not in Lite: </span>{l.text}</>}</span>
        </li>
      ))}
    </ul>
  );

  if (variant === "dialog") {
    return (
      <div className="web-model">
        <div className="web-model-row">
          <div>
            <strong>{model?.name ?? "Universal"}</strong>{" "}
            <span className={`chip${model?.installed ? " ok" : ""}`}>{model?.installed ? "In this browser" : "Not downloaded"}</span>
            <p className="muted">
              {model?.recommended} {bytes(model?.size_bytes ?? 0)}, stored in this browser only.
            </p>
          </div>
          {model?.installed ? (
            <button type="button" className="danger small" onClick={onDelete} disabled={busy}>
              <Trash size={15} /> Delete
            </button>
          ) : (
            <button type="button" className="primary small" onClick={onDownload} disabled={busy || !model || Boolean(progress)}>
              <Download size={15} /> Download
            </button>
          )}
        </div>
        {download}
        {problemText}
        <div>
          <h3 className="web-model-heading">What Lite does</h3>
          {limits}
        </div>
        <aside className="desktop-promo">
          <Monitor size={22} />
          <div>
            <strong>More in the desktop app</strong>
            <p className="muted">
              Full recordings, speaker names and dedicated language models.{" "}
              <button type="button" className="inline-link" onClick={onCompare}>
                Compare with Lite
              </button>
            </p>
          </div>
          <button type="button" className="primary small" onClick={() => onOpenUrl(DESKTOP)}>
            Get the desktop app
          </button>
        </aside>
      </div>
    );
  }

  return (
    <section className="notice web-setup">
      <div className="notice-card">
        <span className="glyph">
          <Lock size={28} />
        </span>
        <h2>Try tlansclaib Lite in your browser</h2>
        <p>The model downloads once ({bytes(model?.size_bytes ?? 0)}) and stays in this browser. Recordings are transcribed on this computer and never uploaded.</p>
        {limits}
        {problemText}
        {download || (
          <div className="actions">
            <button type="button" className="primary" onClick={onDownload} disabled={busy || !model}>
              <Download size={15} /> Download the model
            </button>
            {desktop(false)}
          </div>
        )}
        <p className="muted small-print">{DESKTOP_PITCH}</p>
      </div>
    </section>
  );
}
