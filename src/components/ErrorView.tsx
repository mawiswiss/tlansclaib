import { Alert } from "./icons";

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function ErrorView({ title, message, onRetry }: Props) {
  return (
    <section className="notice">
      <div className="notice-card">
        <span className="glyph problem-glyph">
          <Alert size={28} />
        </span>
        <h2>{title}</h2>
        <p role="alert">{message}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={onRetry}>
            Start over
          </button>
        </div>
      </div>
    </section>
  );
}
