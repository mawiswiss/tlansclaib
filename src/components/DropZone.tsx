import { useEffect } from "react";
import { fileName } from "../lib/format";
import { Close, Wave } from "./icons";

type Props = {
  ready: boolean;
  preparing: { label: string; percent: number } | null;
  /** A download the staged recording waits for. GO stays off until it is done. */
  blocked: { label: string; percent: number } | null;
  dragging: boolean;
  pending: string | null;
  summary: string[];
  onGo: () => void;
  onClear: () => void;
  onChoose: () => void;
  onGetModel: () => void;
};

export function DropZone({ ready, preparing, blocked, dragging, pending, summary, onGo, onClear, onChoose, onGetModel }: Props) {
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      const field = (e.target as HTMLElement | null)?.closest("input, select, textarea, button");
      if (e.key === "Enter" && !field && !blocked) onGo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, blocked, onGo]);

  if (!ready && preparing) {
    return (
      <section className="dropzone disabled">
        <span className="glyph">
          <Wave size={30} />
        </span>
        <h2>Getting your models</h2>
        <p className="muted">{preparing.label}</p>
        <span className="bar dropzone-bar" role="progressbar" aria-valuenow={preparing.percent} aria-valuemin={0} aria-valuemax={100}>
          <span className="fill" style={{ width: `${preparing.percent}%` }} />
        </span>
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="dropzone disabled">
        <span className="glyph">
          <Wave size={30} />
        </span>
        <h2>First, get a model</h2>
        <p className="muted">The app needs a speech model before it can transcribe. Models are downloaded once, or added from a file.</p>
        <button type="button" className="primary large" onClick={onGetModel}>
          Choose a model
        </button>
      </section>
    );
  }
  if (pending) {
    return (
      <section className={`dropzone staged${dragging ? " over" : ""}`}>
        <span className="glyph">
          <Wave size={30} />
        </span>
        <h2 className="staged-name">
          <span title={pending}>{fileName(pending)}</span>
          <button type="button" className="icon-button small" onClick={onClear} aria-label="Remove this recording" title="Remove this recording">
            <Close size={16} />
          </button>
        </h2>
        <button type="button" className="inline-link change-file" onClick={onChoose}>
          Change file
        </button>
        <div className="staged-settings">
          <p className="hint">Transcribed with the settings above</p>
          <div className="chips">
            {summary.filter(Boolean).map((item) => (
              <span key={item} className="chip">
                {item}
              </span>
            ))}
          </div>
        </div>
        {blocked && (
          <div className="staged-wait" role="status">
            <p className="muted">{blocked.label}</p>
            <span className="bar dropzone-bar" role="progressbar" aria-valuenow={blocked.percent} aria-valuemin={0} aria-valuemax={100}>
              <span className="fill" style={{ width: `${blocked.percent}%` }} />
            </span>
          </div>
        )}
        <button type="button" className="primary go" onClick={onGo} disabled={blocked !== null} title={blocked ? "Waits for the download" : undefined}>
          GO
        </button>
      </section>
    );
  }
  return (
    <section className={`dropzone${dragging ? " over" : ""}`} onClick={onChoose}>
      <span className="glyph">
        <Wave size={30} />
      </span>
      <h2>Drop a recording here</h2>
      <p className="muted">m4a, mp3, wav, mp4, flac and most other audio files</p>
      <button
        type="button"
        className="primary large"
        onClick={(e) => {
          e.stopPropagation();
          onChoose();
        }}
      >
        Choose a file…
      </button>
    </section>
  );
}
