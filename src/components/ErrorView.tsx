import { Alert } from "./icons";
import { toneClass, type NoticeAction } from "./Notices";

export type ErrorAction = NoticeAction;

type Props = {
  title: string;
  message: string;
  note?: string;
  onRetry: () => void;
  retryLabel?: string;
  actions?: ErrorAction[];
};

export function ErrorView({ title, message, note, onRetry, retryLabel = "Start over", actions = [] }: Props) {
  return (
    <section className="notice">
      <div className="notice-card">
        <span className="glyph problem-glyph">
          <Alert size={28} />
        </span>
        <h2>{title}</h2>
        <p role="alert">{message}</p>
        <div className="actions">
          {actions.map((action, i) => (
            <button key={action.label} type="button" className={toneClass(action.tone ?? (i === 0 ? "primary" : "neutral"))} onClick={action.run}>
              {action.label}
            </button>
          ))}
          <button type="button" className={actions.length ? undefined : "primary"} onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
        {note && <p className="muted">{note}</p>}
      </div>
    </section>
  );
}
