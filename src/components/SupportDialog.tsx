import { AUTHOR, WEBSITE } from "../lib/about";
import portrait from "../assets/marc.jpg";
import { Heart } from "./icons";

type Props = { onSupport: () => void; onOpenUrl: (url: string) => void; onClose: () => void };

export function SupportDialog({ onSupport, onOpenUrl, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal support" role="dialog" aria-modal="true" aria-labelledby="support-title" onClick={(e) => e.stopPropagation()}>
        <span className="glyph">
          <Heart size={24} />
        </span>
        <h2 id="support-title">Support wavetyper</h2>
        <p className="muted">
          If it has made your work easier, your support helps me keep it maintained. I believe good software should be
          free for everyone to use.
        </p>
        <div className="sign-off">
          <img className="avatar" src={portrait} alt="" width={88} height={88} />
          <span className="faint">{AUTHOR}, indie developer</span>
          <button type="button" className="inline-link" onClick={() => onOpenUrl(WEBSITE)}>
            {new URL(WEBSITE).host}
          </button>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={onSupport}>
            <Heart size={16} /> Support my work
          </button>
          <button type="button" onClick={onClose}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
