import { Alert, Download } from "./icons";

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
      <div className="setup-progress failed" role="alert">
        <Alert size={15} />
        <span className="setup-progress-text">
          Downloading the {mode} models stopped: {error}
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
    <div className="setup-progress" role="status">
      <Download size={15} />
      <span className="setup-progress-text">
        Downloading the {mode} models, {percent}%. {ready ? "You can start a transcription now." : "A transcription can start once the first model is in."}
      </span>
      <span className="bar small" aria-hidden="true">
        <span className="fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
