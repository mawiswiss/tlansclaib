import { describe, expect, it } from "vitest";
import { percent, quietCheckAllowed, releasePage, topBarLabel } from "./update";

describe("quietCheckAllowed", () => {
  it("checks in the background until a download starts", () => {
    expect(quietCheckAllowed({ status: "idle" })).toBe(true);
    expect(quietCheckAllowed({ status: "available", version: "0.4.0" })).toBe(true);
    expect(quietCheckAllowed({ status: "failed", version: null, message: "offline" })).toBe(true);
    expect(quietCheckAllowed({ status: "downloading", version: "0.4.0", received: 1, total: 2 })).toBe(false);
    expect(quietCheckAllowed({ status: "ready", version: "0.4.0" })).toBe(false);
    expect(quietCheckAllowed({ status: "failed", version: "0.4.0", message: "offline" })).toBe(false);
  });
});

describe("topBarLabel", () => {
  it("shows only once a new version is known", () => {
    expect(topBarLabel({ status: "idle" })).toBeNull();
    expect(topBarLabel({ status: "current" })).toBeNull();
    expect(topBarLabel({ status: "failed", version: null, message: "offline" })).toBeNull();
    expect(topBarLabel({ status: "available", version: "0.2.0" })).toBe("Update to 0.2.0");
    expect(topBarLabel({ status: "downloading", version: "0.2.0", received: 0, total: null })).toBe("Updating…");
    expect(topBarLabel({ status: "downloading", version: "0.2.0", received: 45, total: 100 })).toBe("Updating 45%");
    expect(topBarLabel({ status: "failed", version: "0.2.0", message: "offline" })).toBe("Update failed");
  });
});

describe("percent", () => {
  it("is unknown without a size and never passes 100", () => {
    expect(percent(10, null)).toBeNull();
    expect(percent(10, 0)).toBeNull();
    expect(percent(45, 100)).toBe(45);
    expect(percent(120, 100)).toBe(100);
  });
});

describe("releasePage", () => {
  it("links the release of the new version, or the latest one", () => {
    expect(releasePage("0.2.0")).toBe("https://github.com/mawiswiss/tlansclaib/releases/tag/v0.2.0");
    expect(releasePage(null)).toBe("https://github.com/mawiswiss/tlansclaib/releases/latest");
  });
});
