// Copies the brand from the private pro/brand into the app: tokens, fonts, logos and icons.
// Run it from the repository root after the brand changes: node scripts/brand-sync.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRAND = "pro/brand";
const BRAND_PY = "pro/.claude/skills/brand/scripts/brand.py";

if (!existsSync(join(BRAND, "guide.md"))) {
  console.error("pro/brand is not checked out, so the brand files in the app stay as they are.");
  process.exit(1);
}

const css = execFileSync("python3", ["-I", BRAND_PY, "css", BRAND, "--primitives"], { encoding: "utf8" });
writeFileSync("src/styles/tokens.css", `/* Generated from pro/brand by scripts/brand-sync.mjs. Never edit. */\n${css}`);

mkdirSync("src/assets/fonts", { recursive: true });
for (const file of readdirSync(join(BRAND, "fonts"))) {
  if (file.endsWith(".woff2") || file === "LICENSE.txt") copyFileSync(join(BRAND, "fonts", file), join("src/assets/fonts", file));
}

mkdirSync("src/assets/brand", { recursive: true });
for (const file of ["logo.svg", "logo-on-dark.svg", "mark.svg", "mark-small.svg"]) {
  copyFileSync(join(BRAND, "logo", file), join("src/assets/brand", file));
}

const tmp = mkdtempSync(join(tmpdir(), "brand-icons-"));
const render = (logo, name, sizes) => {
  const args = ["-s", "tauri", "icon", join(BRAND, "logo", logo), "-o", join(tmp, name)];
  if (sizes) args.push("--png", sizes.join(","));
  execFileSync("pnpm", args, { stdio: "ignore" });
  return (size) => readFileSync(join(tmp, name, `${size}x${size}.png`));
};
render("app-icon.svg", "full");
const big = render("app-icon.svg", "big", [24, 48, 64, 128, 256, 512, 1024]);
const small = render("mark-small.svg", "small", [16, 32]);
const mark = render("mark.svg", "mark", [48]);
const square = render("app-icon-square.svg", "square", [180]);

const ICONS = "src-tauri/icons";
for (const file of readdirSync(ICONS)) {
  if (existsSync(join(tmp, "full", file))) copyFileSync(join(tmp, "full", file), join(ICONS, file));
}
writeFileSync(join(ICONS, "32x32.png"), small(32));
writeFileSync(join(ICONS, "icon.ico"), ico([[16, small(16)], [24, big(24)], [32, small(32)], [48, big(48)], [64, big(64)], [256, big(256)]]));

const iconset = join(tmp, "icon.iconset");
mkdirSync(iconset);
const sets = { "16x16": small(16), "16x16@2x": small(32), "32x32": small(32), "32x32@2x": big(64), "128x128": big(128), "128x128@2x": big(256), "256x256": big(256), "256x256@2x": big(512), "512x512": big(512), "512x512@2x": big(1024) };
for (const [name, png] of Object.entries(sets)) writeFileSync(join(iconset, `icon_${name}.png`), png);
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(ICONS, "icon.icns")]);

copyFileSync(join(BRAND, "logo", "mark-small.svg"), "public-web/favicon.svg");
writeFileSync("public-web/favicon.ico", ico([[16, small(16)], [32, small(32)], [48, mark(48)]]));
writeFileSync("public-web/apple-touch-icon.png", square(180));

rmSync(tmp, { recursive: true, force: true });
console.log("Brand synced: tokens, fonts, logos and icons.");

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(([size, png]) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(([, png]) => png)]);
}
