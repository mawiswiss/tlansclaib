import { useEffect } from "react";
import { Close } from "./icons";

/** primary is the fix the app recommends, danger deletes or skips a safety check. */
export type Tone = "primary" | "neutral" | "danger";

export type NoticeAction = { label: string; run: () => void; tone?: Tone };

export type Notice = { id: number; kind: "info" | "warning" | "error"; text: string; actions?: NoticeAction[] };

const FADE_MS = 8000;

export function toneClass(tone: Tone = "neutral"): string | undefined {
  return tone === "neutral" ? undefined : tone;
}

function NoticeItem({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const fades = notice.kind === "info" && !notice.actions?.length;
  useEffect(() => {
    if (!fades) return;
    const timer = setTimeout(() => onDismiss(notice.id), FADE_MS);
    return () => clearTimeout(timer);
  }, [fades, notice.id, onDismiss]);
  return (
    <div className={`notice-toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <div className="notice-toast-body">
        <span>{notice.text}</span>
        <button type="button" className="icon-button tiny" onClick={() => onDismiss(notice.id)} aria-label="Dismiss" title="Dismiss">
          <Close size={14} />
        </button>
      </div>
      {notice.actions?.length ? (
        <div className="notice-toast-actions">
          {notice.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={["small", toneClass(action.tone)].filter(Boolean).join(" ")}
              onClick={() => {
                onDismiss(notice.id);
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Notices({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
