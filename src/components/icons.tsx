import type { ReactNode, SVGProps } from "react";
import logoDark from "../assets/brand/logo-on-dark.svg";
import logoLight from "../assets/brand/logo.svg";
import mark from "../assets/brand/mark.svg";

type Props = Omit<SVGProps<SVGSVGElement>, "strokeWidth"> & { size?: 12 | 16 | 20 | 24 };

function Icon({ size = 20, children, ...rest }: Props & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
      style={{ strokeWidth: "var(--size-icon-stroke)", ...rest.style }}
    >
      {children}
    </svg>
  );
}

export const Sun = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Icon>
);

export const Moon = (p: Props) => (
  <Icon {...p}>
    <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.6 6.6 0 0 0 10 10z" />
  </Icon>
);

export const Monitor = (p: Props) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);

export const Clock = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const Cube = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </Icon>
);

export const Close = (p: Props) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const Folder = (p: Props) => (
  <Icon {...p}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z" />
  </Icon>
);

export const Trash = (p: Props) => (
  <Icon {...p}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
  </Icon>
);

export const ChevronDown = (p: Props) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const Check = (p: Props) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);

export const Search = (p: Props) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
);

export const Wave = (p: Props) => (
  <Icon {...p}>
    <path d="M4.3 9.1v5.8M8.15 5.4v13.2M12 7.9v8.2M15.85 6.4v11.2M19.7 10v4" />
  </Icon>
);

export const Info = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.5v.01" />
  </Icon>
);

export const User = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
);

export const Heart = (p: Props) => (
  <Icon {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
  </Icon>
);

export const Code = (p: Props) => (
  <Icon {...p}>
    <path d="M9 8l-4.5 4L9 16M15 8l4.5 4-4.5 4" />
  </Icon>
);

export const LinkIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Icon>
);

export const Download = (p: Props) => (
  <Icon {...p}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const Globe = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z" />
  </Icon>
);

export const Play = (p: Props) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </Icon>
);

export const Pause = (p: Props) => (
  <Icon {...p}>
    <path d="M9 6v12M15 6v12" />
  </Icon>
);

export const Plus = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const Unlink = (p: Props) => (
  <Icon {...p}>
    <path d="M9.5 14.5l-2 2a3 3 0 0 1-4.2-4.2l2-2M14.5 9.5l2-2a3 3 0 0 1 4.2 4.2l-2 2" />
    <path d="M8 3.5v2.5M3.5 8H6M16 20.5V18M20.5 16H18" />
  </Icon>
);

export const Retry = (p: Props) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Icon>
);

export const Pencil = (p: Props) => (
  <Icon {...p}>
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20z" />
  </Icon>
);

export const Undo = (p: Props) => (
  <Icon {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const Redo = (p: Props) => (
  <Icon {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export function Logo() {
  return (
    <span className="logo">
      <img className="only-light" src={logoLight} alt="wavetyper" />
      <img className="only-dark" src={logoDark} alt="wavetyper" />
    </span>
  );
}

export const Mark = () => <img className="mark" src={mark} alt="" />;
