import { describe, expect, it } from "vitest";
import { differs } from "./language";

const heard = (...pairs: [string, number][]) => pairs.map(([code, probability]) => ({ code, probability }));

describe("differs", () => {
  it("names the language heard when the chosen one is clearly absent", () => {
    expect(differs("de", heard(["en", 0.97], ["de", 0.01]))).toBe("en");
    expect(differs("de", heard(["en", 0.7], ["nl", 0.2], ["fr", 0.05]))).toBe("en");
  });

  it("stays quiet for auto-detect, a match, or no detection", () => {
    expect(differs("auto", heard(["en", 0.97]))).toBeNull();
    expect(differs("en", heard(["en", 0.97]))).toBeNull();
    expect(differs("de", [])).toBeNull();
    expect(differs(null, heard(["en", 0.97]))).toBeNull();
  });

  it("stays quiet when the model is unsure or still hears the chosen language", () => {
    expect(differs("de", heard(["en", 0.5], ["de", 0.05]))).toBeNull();
    expect(differs("nn", heard(["no", 0.7], ["nn", 0.25]))).toBeNull();
  });
});
