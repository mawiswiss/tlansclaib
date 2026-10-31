import { RELEASES } from "./about";

export type Platform = "mac" | "windows";

export const INSTALLERS: Record<Platform, { name: string; file: string; url: string; requires: string }> = {
  mac: { name: "Mac", file: "tlansclaib-mac.dmg", url: `${RELEASES}/latest/download/tlansclaib-mac.dmg`, requires: "macOS 13 or newer, Apple silicon or Intel" },
  windows: { name: "Windows", file: "tlansclaib-windows-setup.exe", url: `${RELEASES}/latest/download/tlansclaib-windows-setup.exe`, requires: "Windows 10 or 11" },
};

export function onPhone(userAgent: string): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(userAgent);
}

type Nav = { userAgentData?: { platform?: string }; platform?: string; maxTouchPoints?: number };

export function desktopPlatform(nav: Nav): Platform | null {
  const name = nav.userAgentData?.platform || nav.platform || "";
  if (/^win/i.test(name)) return "windows";
  // Safari on an iPad reports a Mac.
  if (/^mac/i.test(name) && (nav.maxTouchPoints ?? 0) < 2) return "mac";
  return null;
}
