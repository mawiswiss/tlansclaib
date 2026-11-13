import { DEVICE, FEATURES } from "../lib/ipc";
import type { Theme } from "../lib/settings";
import { Clock, Cube, Download, Info, Logo, Monitor, Moon, Sun } from "./icons";

type Props = {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  historyOpen: boolean;
  onHistory?: () => void;
  onModels?: () => void;
  onAbout: () => void;
  update: string | null;
  onUpdate: () => void;
  onDesktop?: () => void;
  busy: boolean;
};

const THEMES: { theme: Theme; title: string; icon: typeof Sun }[] = [
  { theme: "system", title: "Follow the system", icon: Monitor },
  { theme: "light", title: "Light", icon: Sun },
  { theme: "dark", title: "Dark", icon: Moon },
];

export function TopBar({ theme, onTheme, historyOpen, onHistory, onModels, onAbout, update, onUpdate, onDesktop, busy }: Props) {
  return (
    <header className={`topbar${update || FEATURES.lite ? " has-update" : ""}`}>
      <div className="brand">
        <Logo />
        {FEATURES.lite && (
          <span className="lite-pill" title="The web version, with fewer features than the desktop app">
            Lite
          </span>
        )}
      </div>
      <span className="pill status" title={`Recordings and transcripts never leave this ${DEVICE}`}>
        Offline · all local
      </span>
      <span className="spacer" />
      {FEATURES.lite && onDesktop && (
        <button type="button" className="tool update-tool" onClick={onDesktop} aria-label="Get the desktop app" title="Get the desktop app">
          <Monitor />
          <span className="tool-label">Get the desktop app</span>
        </button>
      )}
      {update && (
        <button type="button" className="tool update-tool" onClick={onUpdate} aria-label={update} title={update}>
          <Download />
          <span className="tool-label">{update}</span>
        </button>
      )}
      {onHistory && (
        <button type="button" className={`tool${historyOpen ? " active" : ""}`} onClick={onHistory} aria-expanded={historyOpen} aria-label="History" title="History">
          <Clock />
          <span className="tool-label">History</span>
        </button>
      )}
      {onModels && (
        <button type="button" className="tool" onClick={onModels} disabled={busy} aria-label="Models" title="Models">
          <Cube />
          <span className="tool-label">Models</span>
        </button>
      )}
      <div className="segmented" role="group" aria-label="Appearance">
        {THEMES.map(({ theme: t, title, icon: I }) => (
          <button key={t} type="button" title={title} aria-label={title} aria-pressed={theme === t} onClick={() => onTheme(t)}>
            <I size={16} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-button about-button" onClick={onAbout} title="About wavetyper" aria-label="About wavetyper">
        <Info />
      </button>
    </header>
  );
}
