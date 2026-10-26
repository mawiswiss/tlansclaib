import { useLayoutEffect, useRef, type ReactNode } from "react";
import { bytes } from "../lib/format";
import { percent, releasePage, type UpdateState } from "../lib/update";
import { Download, Globe, Retry } from "./icons";
import { Tooltip } from "./Tooltip";

type Props = {
  state: UpdateState;
  current: string;
  wait: string | null;
  focused: boolean;
  checkOnStart: boolean;
  onCheckOnStart: (on: boolean) => void;
  onCheck: () => void;
  onUpdate: (version: string) => void;
  onInstall: (version: string) => void;
  onOpenUrl: (url: string) => void;
};

export function UpdateSection(props: Props) {
  const { state, wait, onOpenUrl } = props;
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (props.focused) card.current?.scrollIntoView({ block: "center" });
  }, [props.focused]);

  const current = props.current ? `Version ${props.current}` : "This version";
  const whatsNew = (version: string) => (
    <button type="button" className="small" onClick={() => onOpenUrl(releasePage(version))}>
      <Globe size={15} /> What's new
    </button>
  );
  const waiting = (button: ReactNode) => <Tooltip content={wait}>{button}</Tooltip>;

  let title: string;
  let text: string;
  let actions: ReactNode = null;
  let progress: number | null = null;
  switch (state.status) {
    case "idle":
    case "checking":
      title = current;
      text = "Checking asks GitHub for the newest version number and sends nothing else.";
      actions = (
        <button type="button" className="small" onClick={props.onCheck} disabled={state.status === "checking"}>
          <Retry size={15} /> {state.status === "checking" ? "Checking…" : "Check for updates"}
        </button>
      );
      break;
    case "current":
      title = "Up to date";
      text = `${current} is the newest.`;
      actions = (
        <button type="button" className="small" onClick={props.onCheck}>
          <Retry size={15} /> Check again
        </button>
      );
      break;
    case "available":
      title = `Version ${state.version} is available`;
      text = wait ?? `You have ${props.current || "an older version"}. Models, history and settings stay.`;
      actions = (
        <>
          {waiting(
            <button type="button" className="primary small" disabled={wait !== null} onClick={() => props.onUpdate(state.version)}>
              <Download size={15} /> Update and restart
            </button>,
          )}
          {whatsNew(state.version)}
        </>
      );
      break;
    case "downloading":
      title = `Downloading version ${state.version}`;
      progress = percent(state.received, state.total) ?? 0;
      text = `${bytes(state.received)}${state.total ? ` of ${bytes(state.total)}` : ""}. ${wait ?? "The app restarts once it is done."}`;
      break;
    case "ready":
      title = `Version ${state.version} is ready`;
      text = wait ?? "Restart to finish the update.";
      actions = waiting(
        <button type="button" className="primary small" disabled={wait !== null} onClick={() => props.onInstall(state.version)}>
          <Retry size={15} /> Restart to update
        </button>,
      );
      break;
    case "installing":
      title = `Installing version ${state.version}`;
      text = "The app restarts in a moment.";
      break;
    case "failed": {
      const version = state.version;
      title = version ? `Could not update to ${version}` : "Could not check for updates";
      text = state.message;
      actions = (
        <>
          <button type="button" className="small" onClick={() => (version ? props.onUpdate(version) : props.onCheck())} disabled={version !== null && wait !== null}>
            <Retry size={15} /> Try again
          </button>
          <button type="button" className="small" onClick={() => onOpenUrl(releasePage(version))}>
            <Globe size={15} /> Download from GitHub
          </button>
        </>
      );
      break;
    }
  }

  const found = "version" in state && state.version !== null;
  return (
    <section className="about-part update-part">
      <h3>Updates</h3>
      <div ref={card} className={`update-card${found ? " found" : ""}${props.focused ? " focused" : ""}`}>
        <div className="fact update-main">
          <span className="fact-icon">
            <Download size={18} />
          </span>
          <div className="update-text">
            <strong>{title}</strong>
            <p role={state.status === "failed" ? "alert" : undefined}>{text}</p>
            {progress !== null && (
              <span className="bar" role="progressbar" aria-label="Update download" aria-valuenow={progress}>
                <span className="fill" style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
          {actions && <div className="actions update-actions">{actions}</div>}
        </div>
        <label className="update-switch">
          <input type="checkbox" role="switch" className="toggle" checked={props.checkOnStart} onChange={(e) => props.onCheckOnStart(e.target.checked)} />
          <span>
            <strong>Check for updates on start</strong>
            <small>At every start and once a day while the app is open. A new version then shows as a notice and in the top bar.</small>
          </span>
        </label>
      </div>
    </section>
  );
}
