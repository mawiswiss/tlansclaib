import { AUTHOR, WEBSITE } from "../lib/about";
import portrait from "../assets/marc.jpg";
import { Heart } from "./icons";

type Props = { onSupport: () => void; onOpenUrl: (url: string) => void; onClose: () => void };

export function SupportDialog({ onSupport, onOpenUrl, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal support" role="dialog" aria-modal="true" aria-labelledby="support-title" onClick={(e) => e.stopPropagation()}>
        <span className="glyph">
          <Heart size={26} />
        </span>
        <h2 id="support-title">You seem to enjoy tlansclaib</h2>
        <p className="muted">
          If it has made your work a little easier, your support helps me maintain it. I believe good software should be
          accessible to everyone.
        </p>
        <div className="sign-off">
          <img className="avatar" src={portrait} alt="" width={88} height={88} />
          <span className="faint">{AUTHOR}, Indie Developer</span>
          <button type="button" className="inline-link" onClick={() => onOpenUrl(WEBSITE)}>
            {new URL(WEBSITE).host}
          </button>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={onSupport}>
            <Heart size={15} /> Support my work
          </button>
          <button type="button" onClick={onClose}>
            No, thanks
          </button>
        </div>
      </section>
    </div>
  );
}
