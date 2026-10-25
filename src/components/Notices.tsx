import { useEffect } from "react";

export type NoticeAction = { label: string; run: () => void };

export type Notice = { id: number; kind: "info" | "warning" | "error"; text: string; actions?: NoticeAction[] };

const FADE_MS = 8000;

function NoticeItem({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const fades = notice.kind === "info" && !notice.actions?.length;
  useEffect(() => {
    if (!fades) return;
    const timer = setTimeout(() => onDismiss(notice.id), FADE_MS);
    return () => clearTimeout(timer);
  }, [fades, notice.id, onDismiss]);
  return (
    <div className={`notice-toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <span>{notice.text}</span>
      <div className="notice-toast-actions">
        {notice.actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            className="inline-link"
            onClick={() => {
              onDismiss(notice.id);
              action.run();
            }}
          >
            {action.label}
          </button>
        ))}
        <button type="button" className="inline-link" onClick={() => onDismiss(notice.id)}>
          Dismiss
        </button>
      </div>
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
