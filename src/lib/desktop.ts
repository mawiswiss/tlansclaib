import { RELEASES } from "./about";

export type Platform = "mac" | "windows" | "linux";

export const INSTALLERS: Record<Platform, { name: string; file: string; url: string; requires: string }> = {
  mac: { name: "Mac", file: "tlansclaib-mac.dmg", url: `${RELEASES}/latest/download/tlansclaib-mac.dmg`, requires: "macOS 13 or newer, Apple silicon or Intel" },
  windows: { name: "Windows", file: "tlansclaib-windows-setup.exe", url: `${RELEASES}/latest/download/tlansclaib-windows-setup.exe`, requires: "Windows 10 or 11" },
  linux: { name: "Linux", file: "tlansclaib-linux.AppImage", url: `${RELEASES}/latest/download/tlansclaib-linux.AppImage`, requires: "64-bit, Ubuntu 22.04, Debian 12, Fedora 36 or newer" },
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
  // The AppImage is x86_64 only, and client hints name no architecture.
  if (/^linux/i.test(name) && /x86_64/.test(nav.platform ?? "")) return "linux";
  return null;
}
