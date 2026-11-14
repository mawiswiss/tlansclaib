import { onPhone } from "../lib/desktop";
import { bytes } from "../lib/format";
import type { DownloadProgress, ModelStatus } from "../lib/types";
import { Check, Close, Download, Monitor, Trash } from "./icons";

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
  onDesktop: () => void;
  onCompare: () => void;
};

const LIMITS = [
  { text: "The first 10 minutes of each recording", has: true },
  { text: "One model for about 100 languages", has: true },
  { text: "Speaker detection", has: false },
];

const DESKTOP_PITCH = "Lite uses a lightweight model, ideal for trying the app. For full-length recordings with several speakers, use the desktop app.";

export function WebSetup({ variant, model, progress, error, problem, busy, onDownload, onCancel, onDelete, onDesktop, onCompare }: Props) {
  const desktop = (primary: boolean) => (
    <button type="button" className={primary ? "primary" : undefined} onClick={onDesktop}>
      <Monitor size={16} /> Get the desktop app
    </button>
  );
  if (problem && onPhone(navigator.userAgent)) {
    return (
      <section className="notice web-setup">
        <div className="notice-card">
          <h2>
            <span className="fact-icon">
              <Monitor />
            </span>
            Open wavetyper on your computer
          </h2>
          <p>wavetyper transcribes audio and video to text or subtitles on your own computer, in about 100 languages, and never uploads the recording.</p>
          <p>It does not run on a phone or tablet. Open this page in a browser on your computer, or download the free desktop app for Mac, Windows and Linux.</p>
          <div className="actions">{desktop(true)}</div>
        </div>
      </section>
    );
  }
  if (problem) {
    return (
      <section className="notice web-setup">
        <div className="notice-card">
          <h2>
            <span className="dot high" aria-hidden="true" />
            wavetyper&nbsp;Lite does not run in this browser
          </h2>
          <p>wavetyper Lite transcribes audio and video to text or subtitles on your own computer, in about 100 languages, and never uploads the recording.</p>
          <p role="alert">{problem} The desktop app for Mac, Windows and Linux runs on any recent computer.</p>
          <div className="actions">{desktop(true)}</div>
        </div>
      </section>
    );
  }
  const percent = progress?.total ? Math.round((progress.bytes / progress.total) * 100) : 0;
  const download = progress && (
    <div className="web-download" role="status">
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="muted data">
        Downloading {bytes(progress.bytes)} of {bytes(progress.total)}, {percent}%
      </span>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
  const problemText = error && (
    <p className="callout danger" role="alert">
      <span className="dot high" aria-hidden="true" />
      <span>{error}</span>
    </p>
  );
  const limits = (
    <ul className="feature-list web-limits">
      {LIMITS.map((l) => (
        <li key={l.text} className={l.has ? undefined : "missing"}>
          {l.has ? <Check size={16} /> : <Close size={16} />}
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
            <span className="status">
              {model?.installed ? "In this browser" : "Not downloaded"}
            </span>
            <p className="muted">
              {model?.recommended} {bytes(model?.size_bytes ?? 0)}, stored in this browser only.
            </p>
          </div>
          {model?.installed ? (
            <button type="button" className="danger" onClick={onDelete} disabled={busy}>
              <Trash size={16} /> Delete {bytes(model.size_bytes)}
            </button>
          ) : (
            <button type="button" className="primary" onClick={onDownload} disabled={busy || !model || Boolean(progress)}>
              <Download size={16} /> Download
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
          <span className="fact-icon">
            <Monitor />
          </span>
          <div>
            <strong>More in the desktop app</strong>
            <p className="muted">
              It transcribes full recordings, names the speakers and adds dedicated language models. Free for Mac, Windows and Linux.{" "}
              <button type="button" className="inline-link" onClick={onCompare}>
                Compare with Lite
              </button>
            </p>
          </div>
          <button type="button" onClick={onDesktop}>
            Get the desktop app
          </button>
        </aside>
      </div>
    );
  }

  return (
    <section className="notice web-setup">
      <div className="notice-card">
        <h2>Try wavetyper Lite in your browser</h2>
        <p>The model downloads once ({bytes(model?.size_bytes ?? 0)}) and stays in this browser. Recordings are transcribed on this computer and never uploaded.</p>
        {limits}
        {problemText}
        {download || (
          <div className="actions">
            <button type="button" className="primary" onClick={onDownload} disabled={busy || !model}>
              <Download size={16} /> Download the model
            </button>
            {desktop(false)}
          </div>
        )}
        <p className="muted small-print">{DESKTOP_PITCH}</p>
      </div>
    </section>
  );
}
