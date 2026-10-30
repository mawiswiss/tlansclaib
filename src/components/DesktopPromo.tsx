import { DESKTOP } from "../lib/about";
import { duration } from "../lib/format";
import { Monitor } from "./icons";

type Props = { transcribed: number | null; full: number | null; onOpenUrl: (url: string) => void };

export function DesktopPromo({ transcribed, full, onOpenUrl }: Props) {
  const trimmed = transcribed !== null && full !== null && full > transcribed + 1;
  return (
    <aside className="desktop-promo">
      <Monitor size={22} />
      <div>
        <strong>{trimmed ? `This is the first ${duration(transcribed)} of ${duration(full)}` : "Like the result?"}</strong>
        <p className="muted">
          {trimmed ? "The desktop app transcribes the whole recording. " : "The desktop app transcribes recordings of any length. "}
          It also names the speakers and covers about 100 languages, plus dedicated models. Free for Mac and Windows.
        </p>
      </div>
      <button type="button" className="primary small" onClick={() => onOpenUrl(DESKTOP)}>
        Get the desktop app
      </button>
    </aside>
  );
}
