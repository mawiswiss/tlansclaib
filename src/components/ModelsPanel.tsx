import { bytes, capitalize } from "../lib/format";
import type { DownloadProgress, ModelStatus, Stats } from "../lib/types";

type Props = {
  models: ModelStatus[];
  downloads: Record<string, DownloadProgress>;
  stats: Stats | null;
  busy: boolean;
  error: string | null;
  folder: string;
  onDownload: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onAddFile: (id: string | null) => void;
  onDelete: (id: string) => void;
  onShowFolder: () => void;
  onClose: () => void;
};

const GIB = 2 ** 30;

function languagesOf(m: ModelStatus): string {
  if (m.languages.includes("all")) return "All languages";
  return m.languages.map((l) => (l === "th" ? "Thai" : l === "en" ? "English" : capitalize(l))).join(", ");
}

export function ModelsPanel({ models, downloads, stats, busy, error, folder, onDownload, onCancelDownload, onAddFile, onDelete, onShowFolder, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Models</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">
          A model is a whisper.cpp file, usually named ggml-….bin. PyTorch, CTranslate2 and ONNX files from Hugging Face do not work
          here. Bigger models are more accurate and slower, and need the memory shown.
        </p>
        {error && <p className="problem">{error}</p>}
        <ul className="models">
          {models.map((m) => {
            const dl = downloads[m.id];
            const needs = (m.ram_gb + 1) * GIB;
            const tooBig = stats !== null && needs > stats.memory_total;
            return (
              <li key={m.id}>
                <div className="about">
                  <strong>{m.name}</strong>
                  <span className="muted">{m.recommended}</span>
                  <span className="meta">
                    {languagesOf(m)} · {m.label ?? [m.architecture, m.quantization].filter(Boolean).join(", ")} · {bytes(m.size_bytes)} ·
                    needs {m.ram_gb.toFixed(1)} GB of memory
                    {m.license && m.source && (
                      <>
                        {" "}· <a href={m.source} target="_blank" rel="noreferrer">source</a>, {m.license}
                      </>
                    )}
                  </span>
                  {tooBig && <span className="badge">Needs more memory than this computer has</span>}
                  {!m.installed && !m.url && !dl && (
                    <span className="meta">Expected file: {m.file}, {bytes(m.size_bytes)}</span>
                  )}
                </div>
                <div className="state">
                  {m.installed ? (
                    <>
                      <span className="ok">Installed</span>
                      <button type="button" onClick={() => onDelete(m.id)} disabled={busy}>
                        Delete
                      </button>
                    </>
                  ) : dl ? (
                    <>
                      <div className="bar small">
                        <div className="fill" style={{ width: `${dl.total ? Math.round((dl.bytes / dl.total) * 100) : 0}%` }} />
                      </div>
                      <span className="muted">
                        {bytes(dl.bytes)} of {bytes(dl.total)}
                      </span>
                      <button type="button" onClick={() => onCancelDownload(m.id)}>
                        Cancel
                      </button>
                    </>
                  ) : m.url ? (
                    <button type="button" className="primary" onClick={() => onDownload(m.id)}>
                      Download
                    </button>
                  ) : (
                    <button type="button" className="primary" onClick={() => onAddFile(m.id)}>
                      Add file…
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <footer>
          <button type="button" onClick={() => onAddFile(null)}>
            Add any model file…
          </button>
          <button type="button" onClick={onShowFolder} title={folder}>
            Show models folder
          </button>
        </footer>
      </section>
    </div>
  );
}
