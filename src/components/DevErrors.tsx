import { Close } from "./icons";
import type { Notice, NoticeAction } from "./Notices";

export type DevScreen = "fail" | "cancelled";
export type DevInline = "models" | "setup" | "speed" | "history" | "result";

type Props = {
  onToast: (kind: Notice["kind"], text: string, actions?: NoticeAction[]) => void;
  onScreen: (screen: DevScreen) => void;
  onInline: (target: DevInline, text: string) => void;
  onClose: () => void;
};

let count = 0;

const LONG =
  "Downloading Large v3 failed: the connection to the model server closed after 1.2 GB of 3.1 GB. The partial file was removed, so the next try starts from the beginning.";

export default function DevErrors({ onToast, onScreen, onInline, onClose }: Props) {
  // notify drops a text that is already showing, so each one gets its own number.
  const toast = (kind: Notice["kind"], text: string, actions?: NoticeAction[]) => onToast(kind, `${text} #${++count}`, actions);
  const pressed = (label: string): NoticeAction => ({ label, run: () => toast("info", `Pressed ${label}`) });
  const inline = (target: DevInline, text: string) => onInline(target, `${text} #${++count}`);

  const toasts: [string, () => void][] = [
    ["Info, fades", () => toast("info", "Saved the transcript.")],
    ["Info with action", () => toast("info", "A new version is ready.", [pressed("Restart")])],
    ["Warning", () => toast("warning", "Transcribing without the memory check at the start.")],
    ["Error with retry", () => toast("error", "Downloading Base failed: no connection.", [{ ...pressed("Try again"), tone: "primary" }])],
    ["Long error", () => toast("error", LONG)],
    ["Burst of 5", () => ["info", "warning", "error", "info", "warning"].forEach((kind) => toast(kind as Notice["kind"], `Burst ${kind}`))],
  ];
  const screens: [string, DevScreen][] = [
    ["Transcription failed", "fail"],
    ["Cancelled", "cancelled"],
  ];
  const inlines: [string, DevInline, string][] = [
    ["Models dialog", "models", "Could not delete the model: permission denied."],
    ["Setup", "setup", "Could not apply the setup: the disk is full."],
    ["Speed measurement", "speed", "Error: no connection to the model server"],
    ["History", "history", "Could not load the history: the file is damaged."],
    ["Open result", "result", "Could not export the transcript: permission denied."],
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="dev-errors-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="dev-errors-title">Test errors</h2>
            <p className="muted">Development builds only. Nothing here touches models, files or runs.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body">
          <section className="about-part">
            <h3>Toasts</h3>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              {toasts.map(([label, run]) => (
                <button key={label} type="button" className="small" onClick={run}>
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="about-part">
            <h3>Error screens</h3>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              {screens.map(([label, screen]) => (
                <button key={label} type="button" className="small" onClick={() => onScreen(screen)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="about-part">
            <h3>Inline errors</h3>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              {inlines.map(([label, target, text]) => (
                <button key={label} type="button" className="small" onClick={() => inline(target, text)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="muted">The result error shows once a transcript is open. Memory, speaker detection and too-heavy cards use the mock flags in docs/development.md.</p>
          </section>
        </div>
      </section>
    </div>
  );
}
