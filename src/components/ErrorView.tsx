import { Alert } from "./icons";

export type ErrorAction = { label: string; run: () => void };

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
            <button key={action.label} type="button" className={i === 0 ? "primary" : undefined} onClick={action.run}>
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
