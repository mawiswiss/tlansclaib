import { useEffect, useState } from "react";
import { AUTHOR, GITHUB, WEBSITE, YEAR } from "../lib/about";
import { DEVICE, FEATURES } from "../lib/ipc";
import type { UpdateState } from "../lib/update";
import { Check, Close, Code, Globe, Heart, Mark, Monitor, User } from "./icons";
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
  onDesktop: () => void;
  onSupport: () => void;
  onDev?: () => void;
  onClose: () => void;
};

const LIST = FEATURES.lite
  ? [
      "Runs on the graphics chip, in this browser",
      "About 100 languages",
      "The first 10 minutes of each recording",
      "Timecodes on or off, export text or subtitles when you want",
      "Free, with no ads, no tracking and no subscription",
    ]
  : FEATURES.mobile
  ? [
      "Runs on the phone's own chip, offline",
      "About 100 languages, plus dedicated models",
      "Timecodes on or off, copy the text when you want",
      "A history of every transcript",
      "Stops before the phone runs out of memory",
      "Free, with no ads, no tracking and no subscription",
    ]
  : [
  "Runs on the Apple GPU or the processor",
  "About 100 languages, plus dedicated models",
  "Timecodes on or off, export text or subtitles when you want",
  "A history of every transcript",
  "Stops before the computer runs out of RAM",
  "Free, with no ads, no tracking and no subscription",
];

export function AboutDialog(props: Props) {
  const { version, onOpenUrl, onDesktop, onSupport, onClose } = props;
  const [v, setV] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);
  useEffect(() => {
    void version().then(setV).catch((error) => setVersionError(`Could not read the app version: ${String(error)}`));
  }, [version]);
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head about-head">
          <Mark />
          <div>
            <h2 id="about-title">{FEATURES.lite ? "tlansclaib Lite" : "tlansclaib"}</h2>
            <p className="muted">{FEATURES.lite ? "Private transcription in your browser" : FEATURES.mobile ? "Private transcription that works offline, on your phone" : "Private transcription that works offline"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body about-body">
          <section className="about-part">
            <h3>Features</h3>
            <div className="privacy">
              <strong>Your recordings never leave this {DEVICE}</strong>
              <p>
                {FEATURES.lite
                  ? "Nothing is uploaded, there is no account and no cookies. The model downloads once and runs in this browser."
                  : "Nothing is uploaded, nothing is tracked and there is no account. Once a model is installed, you don't need internet."}
              </p>
            </div>
            <ul className="feature-list">
              {LIST.map((f) => (
                <li key={f}>
                  <Check size={16} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="about-part">
            <h3>About the app</h3>
            <div className="fact">
              <span className="fact-icon">
                <User size={20} />
              </span>
              <div>
                <strong>Made by an indie developer</strong>
                <p>{AUTHOR} builds and maintains tlansclaib independently.</p>
                <div className="actions">
                  <button type="button" className="small" onClick={() => onOpenUrl(WEBSITE)}>
                    <Globe size={16} /> Website
                  </button>
                  <button type="button" className="small" onClick={() => onOpenUrl(GITHUB)}>
                    <Code size={16} /> GitHub
                  </button>
                </div>
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Code size={20} />
              </span>
              <div>
                <strong>Open source</strong>
                <p>MIT license. Built on whisper.cpp and open speech models from their authors.</p>
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Monitor size={20} />
              </span>
              <div>
                <strong>For macOS, Windows and Linux</strong>
                <p>macOS 13 or newer on Apple silicon or Intel, Windows 10 and 11, 64-bit Linux such as Ubuntu 22.04, Debian 12, Fedora 36 or newer.</p>
                {FEATURES.lite && (
                  <div className="actions">
                    <button type="button" className="small" onClick={onDesktop}>
                      <Monitor size={16} /> Get the desktop app
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="fact">
              <span className="fact-icon">
                <Heart size={20} />
              </span>
              <div>
                <strong>Support tlansclaib</strong>
                <p>If it saves you time, a contribution helps me keep it maintained.</p>
                <div className="actions">
                  <button type="button" className="small" onClick={onSupport}>
                    <Heart size={16} /> Support my work
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
          {import.meta.env.DEV && props.onDev && (
            <button type="button" className="small" onClick={props.onDev}>
              Test errors
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
