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

/** How often a window left open asks again, after the check at start. */
export const RECHECK_MS = 24 * 60 * 60 * 1000;

/** A check in the background may announce a version, but never interrupts a download or install that is under way. */
export function quietCheckAllowed(state: UpdateState): boolean {
  return state.status === "idle" || state.status === "current" || state.status === "available" || (state.status === "failed" && state.version === null);
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
