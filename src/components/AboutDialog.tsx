import { useEffect, useState } from "react";
import { AUTHOR, DESKTOP, GITHUB, WEBSITE, YEAR } from "../lib/about";
import { FEATURES } from "../lib/ipc";
import type { UpdateState } from "../lib/update";
import { Check, Close, Code, Globe, Heart, Lock, Logo, Monitor, User } from "./icons";
import { UpdateSection } from "./UpdateSection";

type Props = {
  version: () => Promise<string>;
  focus: "update" | null;
  update: UpdateState;
  updateWait: string | null;
  checkOnStart: boolean;
  onCheckOnStart: (on: boolean) => void;
  onCheckUpdate: () => void;
  onUpdate: (version: string) => void;
  onInstallUpdate: (version: string) => void;
  onOpenUrl: (url: string) => void;
  onSupport: () => void;
  onClose: () => void;
};

const LIST = FEATURES.lite
  ? [
      "Runs the model on the graphics chip, in this browser",
      "About 100 languages",
      "The first 10 minutes of each recording",
      "Timecodes on or off, export text or subtitles when you want",
      "A history of every transcript, kept in this browser",
      "Free, with no ads, no tracking and no subscription",
    ]
  : [
  "Runs on the Apple GPU or the processor",
  "About 100 languages, with special models for Thai, Swiss German and German",
  "Timecodes on or off, export text or subtitles when you want",
  "A history of every transcript",
  "Stops before the computer runs out of RAM",
  "Free, with no ads, no tracking and no subscription",
];

export function AboutDialog(props: Props) {
  const { version, onOpenUrl, onSupport, onClose } = props;
  const [v, setV] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);
  useEffect(() => {
    void version().then(setV).catch((error) => setVersionError(`Could not read the app version: ${String(error)}`));
  }, [version]);
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head about-head">
          <Logo size={44} />
          <div>
            <h2 id="about-title">{FEATURES.lite ? "tlansclaib Lite" : "tlansclaib"}</h2>
            <p className="muted">{FEATURES.lite ? "The web version of the transcription app for Mac and Windows" : "Offline transcription for Mac and Windows"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body about-body">
          <section className="about-part">
            <h3>Features</h3>
            <div className="privacy">
              <span className="fact-icon">
                <Lock size={20} />
              </span>
              <div>
                <strong>Your recordings never leave this computer</strong>
                <p>
                  {FEATURES.lite
                    ? "No uploads, no analytics, no account. The model downloads once and runs in this browser."
                    : "No uploads, no analytics, no account. Once a model is installed, no internet is needed."}
                </p>
              </div>
            </div>
            <ul className="feature-list">
              {LIST.map((f) => (
                <li key={f}>
                  <Check size={15} strokeWidth={2.2} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="about-part">
            <h3>About the app</h3>
            <div className="fact">
              <span className="fact-icon">
                <User size={18} />
              </span>
              <div>
                <strong>Made by an indie developer</strong>
                <p>{AUTHOR} builds and maintains tlansclaib independently.</p>
                <div className="actions">
                  <button type="button" className="small" onClick={() => onOpenUrl(WEBSITE)}>
                    <Globe size={15} /> Website
                  </button>
                  <button type="button" className="small" onClick={() => onOpenUrl(GITHUB)}>
                    <Code size={15} /> GitHub
                  </button>
                </div>
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Code size={18} />
              </span>
              <div>
                <strong>Open source</strong>
                <p>MIT license. Built on whisper.cpp and open-weight speech models from their authors.</p>
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Monitor size={18} />
              </span>
              <div>
                <strong>For macOS and Windows</strong>
                <p>macOS 13 or newer on Apple silicon or Intel, Windows 10 and 11.</p>
                {FEATURES.lite && (
                  <div className="actions">
                    <button type="button" className="primary small" onClick={() => onOpenUrl(DESKTOP)}>
                      <Monitor size={15} /> Get the desktop app
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Heart size={18} />
              </span>
              <div>
                <strong>Keep tlansclaib going</strong>
                <p>If it saves you time, a contribution helps me keep it maintained and improving.</p>
                <div className="actions">
                  <button type="button" className="primary small" onClick={onSupport}>
                    <Heart size={15} /> Support my work
                  </button>
                </div>
              </div>
            </div>
          </section>
          {FEATURES.updates && (
          <UpdateSection
            state={props.update}
            current={v}
            wait={props.updateWait}
            focused={props.focus === "update"}
            checkOnStart={props.checkOnStart}
            onCheckOnStart={props.onCheckOnStart}
            onCheck={props.onCheckUpdate}
            onUpdate={props.onUpdate}
            onInstall={props.onInstallUpdate}
            onOpenUrl={onOpenUrl}
          />
          )}
        </div>
        <footer className="modal-foot about-foot">
          <span className="muted">
            © {YEAR} {AUTHOR} · MIT License{v && ` · Version ${v}`}
            {versionError && <span role="alert"> · {versionError}</span>}
          </span>
        </footer>
      </section>
    </div>
  );
}
