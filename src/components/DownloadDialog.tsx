import { INSTALLERS, type Platform } from "../lib/desktop";
import { Close, Download, Monitor } from "./icons";

type Props = { platform: Platform | null; onDownload: (platform: Platform) => void; onClose: () => void };

const STEPS: Record<Platform, string[]> = {
  mac: ["Open tlansclaib-mac.dmg from your Downloads.", "Drag tlansclaib into Applications and start it from there."],
  windows: [
    "Run tlansclaib-windows-setup.exe from your Downloads.",
    "Windows may say “Windows protected your PC”, because the installer is not signed yet. Click “More info”, then “Run anyway”.",
  ],
};

export function DownloadDialog({ platform, onDownload, onClose }: Props) {
  const other: Platform = platform === "mac" ? "windows" : "mac";
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal compare download" role="dialog" aria-modal="true" aria-labelledby="download-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button compare-close" onClick={onClose} aria-label="Close">
          <Close />
        </button>
        <span className="glyph">
          {platform ? <Download size={28} /> : <Monitor size={28} />}
        </span>
        {platform ? (
          <>
            <h2 id="download-title">Your download has started</h2>
            <p className="muted">tlansclaib for {INSTALLERS[platform].name}, {INSTALLERS[platform].requires}.</p>
            <ol className="download-steps">
              {STEPS[platform].map((step) => (
                <li key={step}>{step}</li>
              ))}
              <li>On the first start, download a model for your language.</li>
            </ol>
            <p className="muted">
              Nothing happened?{" "}
              <button type="button" className="inline-link" onClick={() => onDownload(platform)}>
                Download again
              </button>
            </p>
            <div className="actions">
              <button type="button" className="primary" onClick={onClose}>
                Done
              </button>
            </div>
            <p className="faint">
              <button type="button" className="inline-link" onClick={() => onDownload(other)}>
                Need it for {INSTALLERS[other].name} instead?
              </button>
            </p>
          </>
        ) : (
          <>
            <h2 id="download-title">tlansclaib runs on Mac and Windows</h2>
            <p className="muted">The desktop app is free. Download it on the computer you want to transcribe on.</p>
            <div className="download-choices">
              {(["mac", "windows"] as const).map((p) => (
                <div key={p}>
                  <button type="button" className="primary" onClick={() => onDownload(p)}>
                    <Download size={15} /> Download for {INSTALLERS[p].name}
                  </button>
                  <small className="faint">{INSTALLERS[p].requires}</small>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
