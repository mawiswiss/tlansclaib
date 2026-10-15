import { Alert } from "./icons";

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
  onSaveElsewhere: (() => void) | null;
};

export function ErrorView({ title, message, onRetry, onSaveElsewhere }: Props) {
  return (
    <section className="notice">
      <div className="notice-card">
        <span className="glyph problem-glyph">
          <Alert size={28} />
        </span>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={onRetry}>
            Start over
          </button>
          {onSaveElsewhere && (
            <button type="button" onClick={onSaveElsewhere}>
              Save the transcript somewhere else…
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
