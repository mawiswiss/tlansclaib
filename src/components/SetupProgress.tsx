
type Props = {
  mode: string;
  percent: number;
  ready: boolean;
  error: string | null;
  onRetry: () => void;
  onDetails: () => void;
};

export function SetupProgress({ mode, percent, ready, error, onRetry, onDetails }: Props) {
  if (error) {
    return (
      <div className="progress-strip failed" role="alert">
        <span className="dot high" aria-hidden="true" />
        <span className="progress-strip-text">
          The {mode} models stopped downloading: {error}
        </span>
        <button type="button" className="inline-link" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="inline-link" onClick={onDetails}>
          Models
        </button>
      </div>
    );
  }
  return (
    <div className="progress-strip" role="status">
      <span className="progress-strip-text">
        Downloading the {mode} models, {percent}%. {ready ? "You can transcribe now." : "You can transcribe once the first model is in."}
      </span>
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
