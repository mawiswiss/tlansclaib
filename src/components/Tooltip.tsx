import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = { content: ReactNode; children: ReactNode; className?: string; oneLine?: boolean };

const MARGIN = 8;

export function Tooltip({ content, children, className, oneLine }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = bubble.current;
    if (!open || !a || !b) return;
    const width = b.offsetWidth;
    const height = b.offsetHeight;
    const left = Math.min(Math.max(a.left + a.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN);
    const above = a.top - MARGIN - height;
    b.style.left = `${left}px`;
    b.style.top = `${above >= MARGIN ? above : a.bottom + MARGIN}px`;
    b.style.visibility = "visible";
  }, [open, content]);

  return (
    <span
      ref={anchor}
      className={`tip-anchor${className ? ` ${className}` : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
    >
      {children}
      {open &&
        content &&
        createPortal(
          <span ref={bubble} role="tooltip" className={`tip${oneLine ? " one-line" : ""}`}>
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
