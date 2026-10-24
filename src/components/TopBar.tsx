import type { Theme } from "../lib/settings";
import { Clock, Cube, Download, Info, Lock, Logo, Monitor, Moon, Sun } from "./icons";

type Props = {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  historyOpen: boolean;
  onHistory: () => void;
  onModels: () => void;
  onAbout: () => void;
  update: string | null;
  onUpdate: () => void;
  busy: boolean;
};

const THEMES: { theme: Theme; title: string; icon: typeof Sun }[] = [
  { theme: "system", title: "Follow the system", icon: Monitor },
  { theme: "light", title: "Light", icon: Sun },
  { theme: "dark", title: "Dark", icon: Moon },
];

export function TopBar({ theme, onTheme, historyOpen, onHistory, onModels, onAbout, update, onUpdate, busy }: Props) {
  return (
    <header className={`topbar${update ? " has-update" : ""}`}>
      <div className="brand">
        <Logo size={26} />
        <span>tlansclaib</span>
        <span className="tagline" title="Recordings and transcripts never leave this computer">
          <Lock size={13} />
          Offline processing<span className="tagline-more"> · nothing leaves this computer</span>
        </span>
      </div>
      <span className="spacer" />
      {update && (
        <button type="button" className="tool update-tool" onClick={onUpdate}>
          <Download />
          {update}
        </button>
      )}
      <button type="button" className={`tool${historyOpen ? " active" : ""}`} onClick={onHistory} aria-expanded={historyOpen}>
        <Clock />
        History
      </button>
      <button type="button" className="tool" onClick={onModels} disabled={busy}>
        <Cube />
        Models
      </button>
      <div className="segmented" role="group" aria-label="Appearance">
        {THEMES.map(({ theme: t, title, icon: I }) => (
          <button key={t} type="button" title={title} aria-label={title} aria-pressed={theme === t} onClick={() => onTheme(t)}>
            <I size={16} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-button about-button" onClick={onAbout} title="About tlansclaib" aria-label="About tlansclaib">
        <Info />
      </button>
    </header>
  );
}
