import { describe, expect, it } from "vitest";
import { desktopPlatform, onPhone } from "./desktop";

describe("desktopPlatform", () => {
  it("reads the platform from client hints first", () => {
    expect(desktopPlatform({ userAgentData: { platform: "macOS" }, platform: "MacIntel" })).toBe("mac");
    expect(desktopPlatform({ userAgentData: { platform: "Windows" }, platform: "Win32" })).toBe("windows");
    expect(desktopPlatform({ userAgentData: { platform: "" }, platform: "Win32" })).toBe("windows");
  });

  it("falls back to navigator.platform in Safari and Firefox", () => {
    expect(desktopPlatform({ platform: "MacIntel", maxTouchPoints: 0 })).toBe("mac");
    expect(desktopPlatform({ platform: "Win32" })).toBe("windows");
  });

  it("tells phones and tablets from computers", () => {
    expect(onPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true);
    expect(onPhone("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe(true);
    expect(onPhone("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe(false);
    expect(onPhone("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe(false);
  });

  it("knows no installer for other systems", () => {
    expect(desktopPlatform({ platform: "MacIntel", maxTouchPoints: 5 })).toBeNull();
    expect(desktopPlatform({ platform: "iPhone", maxTouchPoints: 5 })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Android" }, platform: "Linux armv8l" })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Linux" }, platform: "Linux x86_64" })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Chrome OS" } })).toBeNull();
    expect(desktopPlatform({})).toBeNull();
  });
});
