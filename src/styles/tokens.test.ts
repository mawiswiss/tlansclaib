import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const LITERAL = /#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/gi;

describe("colors", () => {
  it("come only from the brand tokens", () => {
    const found: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }) as string[]) {
      if (!/\.(css|tsx?)$/.test(file) || file === join("styles", "tokens.css")) continue;
      readFileSync(join(SRC, file), "utf8").split("\n").forEach((line, i) => {
        for (const match of line.matchAll(LITERAL)) found.push(`src/${file}:${i + 1} ${match[0]}`);
      });
    }
    expect(found).toEqual([]);
  });
});
