import { RELEASES } from "./about";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; received: number; total: number | null }
  | { status: "ready"; version: string }
  | { status: "installing"; version: string }
  | { status: "failed"; version: string | null; message: string };

const DAY = 24 * 60 * 60 * 1000;

export function checkDue(enabled: boolean, checkedAt: number | null, now: number): boolean {
  return enabled && (checkedAt === null || now - checkedAt >= DAY || now < checkedAt);
}

export function topBarLabel(state: UpdateState): string | null {
  switch (state.status) {
    case "available":
      return `Update to ${state.version}`;
    case "downloading": {
      const done = percent(state.received, state.total);
      return done === null ? "Updating…" : `Updating ${done}%`;
    }
    case "ready":
      return "Update ready";
    case "installing":
      return "Restarting…";
    case "failed":
      return state.version ? "Update failed" : null;
    default:
      return null;
  }
}

export function percent(received: number, total: number | null): number | null {
  return total ? Math.min(100, Math.round((received / total) * 100)) : null;
}

export function releasePage(version: string | null): string {
  return version ? `${RELEASES}/tag/v${version}` : `${RELEASES}/latest`;
}
