type Props = {
  title: string;
  message: string;
  onRetry: () => void;
  onSaveElsewhere: (() => void) | null;
};

export function ErrorView({ title, message, onRetry, onSaveElsewhere }: Props) {
  return (
    <section className="error">
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
    </section>
  );
}
