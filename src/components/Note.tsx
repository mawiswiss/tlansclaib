import type { ReactNode } from "react";
import { Alert, Close } from "./icons";

export function Note({ warn = false, children, onDismiss }: { warn?: boolean; children: ReactNode; onDismiss: () => void }) {
  return (
    <div className={`note dismissable${warn ? " warn" : ""}`}>
      {warn && <Alert size={15} />}
      <p>{children}</p>
      <button type="button" className="icon-button tiny" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <Close size={14} />
      </button>
    </div>
  );
}
