import { DESKTOP } from "../lib/about";
import { Check, Close, Monitor } from "./icons";

type Props = { onOpenUrl: (url: string) => void; onClose: () => void };

type Cell = string | boolean;

const ROWS: { label: string; lite: Cell; desktop: Cell }[] = [
  { label: "Recording length", lite: "First 10 minutes", desktop: "Any length" },
  { label: "File size", lite: "Up to 1 GB", desktop: "Any size" },
  { label: "Accuracy", lite: "More mistakes", desktop: "Larger models, fewer mistakes" },
  { label: "Speaker detection", lite: false, desktop: true },
  { label: "Languages", lite: "About 100, one model", desktop: "About 100, plus dedicated models" },
  { label: "Stays on this computer", lite: true, desktop: true },
  { label: "Install", lite: "Nothing to install", desktop: "Mac and Windows" },
  { label: "Price", lite: "Free", desktop: "Free" },
];

function cell(value: Cell) {
  if (value === true) return <Check size={16} strokeWidth={2.2} className="yes" role="img" aria-hidden={false} aria-label="Yes" />;
  if (value === false) return <Close size={16} strokeWidth={2.2} className="no" role="img" aria-hidden={false} aria-label="No" />;
  return value;
}

export function CompareDialog({ onOpenUrl, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal compare" role="dialog" aria-modal="true" aria-labelledby="compare-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button compare-close" onClick={onClose} aria-label="Close">
          <Close />
        </button>
        <span className="glyph">
          <Monitor size={28} />
        </span>
        <h2 id="compare-title">Lite or the desktop app</h2>
        <p className="muted">Both transcribe on this computer. The desktop app has no limits on length or size, runs larger and more accurate models, and names the speakers.</p>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Feature</span>
              </th>
              <th scope="col">Lite</th>
              <th scope="col">Desktop app</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{cell(r.lite)}</td>
                <td>{cell(r.desktop)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onOpenUrl(DESKTOP)}>
            <Monitor size={15} /> Get the desktop app
          </button>
          <button type="button" onClick={onClose}>
            Keep using Lite
          </button>
        </div>
      </section>
    </div>
  );
}
