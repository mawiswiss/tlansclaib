import { FEATURES } from "../lib/ipc";
import { useEffect, useMemo, useRef, useState } from "react";
import { clock, folderOf, titleOf } from "../lib/format";
import type { HistoryEntry } from "../lib/types";
import { Close, Folder, Pencil, Retry, Search } from "./icons";

type Props = {
  open: boolean;
  entries: HistoryEntry[];
  languageName: (code: string) => string;
  busy: boolean;
  error: string | null;
  onOpen: (entry: HistoryEntry) => void;
  onLocate: (entry: HistoryEntry) => void;
  onRerun: (entry: HistoryEntry) => void;
  onReveal: (path: string) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
};

function when(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function HistoryDrawer({ open, entries, languageName, busy, error, onOpen, onLocate, onRerun, onReveal, onRemove, onClose }: Props) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => [e.title ?? titleOf(e.file), e.audio, e.file, e.model].some((s) => s.toLowerCase().includes(q)));
  }, [entries, query]);

  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [query]);

  return (
    <>
      <div className={`drawer-backdrop${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`drawer${open ? " open" : ""}`} aria-label="History" aria-hidden={!open} inert={!open}>
        <header className="drawer-head">
          <div>
            <h2>History</h2>
            <p className="muted">{entries.length === 1 ? "1 transcript" : `${entries.length} transcripts`}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close history">
            <Close />
          </button>
        </header>
        <label className="search">
          <Search size={16} />
          <input type="search" placeholder="Find by name or folder" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {error && <p className="problem history-error" role="alert">{error}</p>}
        <ul className="history" ref={list}>
          {entries.length === 0 && <li className="empty">Transcripts appear here once the first recording is done.</li>}
          {entries.length > 0 && shown.length === 0 && <li className="empty">Nothing matches “{query}”.</li>}
          {shown.map((e) => (
            <li key={e.id} className={`entry${e.exists ? "" : " missing"}`}>
              {e.exists ? (
                <button
                  type="button"
                  className="entry-main"
                  onClick={() => onOpen(e)}
                  disabled={busy}
                  title={busy ? "Available when the transcription is done" : `Open ${e.title ?? titleOf(e.file)}`}
                >
                  <span className="entry-top">
                    <strong>{e.title ?? titleOf(e.file)}</strong>
                    <span className="when">{when(e.finished_at)}</span>
                  </span>
                  <span className="entry-meta">
                    {e.status === "incomplete" && <span className="dot warn" title="Stopped early" />}
                    {e.edited === true && (
                      <span className="entry-edited" title="Corrected by hand">
                        <Pencil size={11} strokeWidth={2.2} />
                        Edited
                      </span>
                    )}
                    {e.audio_seconds !== null ? clock(e.audio_seconds) : `${e.lines} lines`} · {e.model}
                    {e.language && <> · {languageName(e.language)}</>}
                  </span>
                  <span className="entry-path">{e.file.endsWith(".json") ? (FEATURES.lite ? "This browser" : "App history") : folderOf(e.file)}</span>
                </button>
              ) : (
                <div className="entry-main" title={e.file}>
                  <span className="entry-top">
                    <strong>{e.title ?? titleOf(e.file)}</strong>
                    <span className="when">{when(e.finished_at)}</span>
                  </span>
                  <span className="entry-meta">
                    <span className="problem-text">Transcript unavailable</span>
                  </span>
                  <span className="entry-fix">
                    {e.audio_exists && (
                      <button
                        type="button"
                        className="entry-retry"
                        onClick={() => onRerun(e)}
                        disabled={busy}
                        title={`Transcribe the recording again: ${[e.model, e.language && languageName(e.language), e.timestamps ? "timecodes" : "no timecodes"].filter(Boolean).join(", ")}`}
                      >
                        <Retry size={14} />
                        Transcribe again
                      </button>
                    )}
                    {!e.file.endsWith(".json") && <button type="button" className="inline-link" onClick={() => onLocate(e)}>
                      Locate…
                    </button>}
                  </span>
                </div>
              )}
              <span className="entry-actions">
                <button type="button" className="icon-button small" onClick={() => onRemove(e.id)} title={e.file.endsWith(".json") ? "Delete transcript" : "Remove from the list"} aria-label={e.file.endsWith(".json") ? `Delete ${e.title ?? titleOf(e.file)}` : `Remove ${e.title ?? titleOf(e.file)} from the list`}>
                  <Close size={15} />
                </button>
                {!e.file.endsWith(".json") && <button type="button" className="icon-button small" onClick={() => onReveal(e.file)} disabled={!e.exists} title="Show in folder" aria-label="Show in folder">
                  <Folder size={16} />
                </button>}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
