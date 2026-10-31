import { describe, expect, it } from "vitest";
import { desktopPlatform } from "./desktop";

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

  it("knows no installer for other systems", () => {
    expect(desktopPlatform({ platform: "MacIntel", maxTouchPoints: 5 })).toBeNull();
    expect(desktopPlatform({ platform: "iPhone", maxTouchPoints: 5 })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Android" }, platform: "Linux armv8l" })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Linux" }, platform: "Linux x86_64" })).toBeNull();
    expect(desktopPlatform({ userAgentData: { platform: "Chrome OS" } })).toBeNull();
    expect(desktopPlatform({})).toBeNull();
  });
});
