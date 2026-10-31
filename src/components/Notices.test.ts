import { describe, expect, it } from "vitest";
import { fadeAfter, type Notice } from "./Notices";

const notice = (kind: Notice["kind"], actions = 0): Notice => ({ id: 1, kind, text: "", actions: Array.from({ length: actions }, () => ({ label: "Do", run: () => {} })) });

describe("fadeAfter", () => {
  it("lets only plain information fade on the desktop", () => {
    expect(fadeAfter(notice("info"), false)).toBe(8000);
    expect(fadeAfter(notice("info", 1), false)).toBeNull();
    expect(fadeAfter(notice("warning"), false)).toBeNull();
  });

  it("keeps only errors open on a phone", () => {
    expect(fadeAfter(notice("info"), true)).toBe(4000);
    expect(fadeAfter(notice("info", 1), true)).toBe(8000);
    expect(fadeAfter(notice("warning"), true)).toBe(8000);
    expect(fadeAfter(notice("error"), true)).toBeNull();
  });
});
