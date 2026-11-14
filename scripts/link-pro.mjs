import { existsSync, lstatSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = ".claude/skills/brand";
const wanted = "../../pro/.claude/skills/brand";

if (existsSync(join(root, "pro/.claude/skills/brand"))) {
  const path = join(root, at);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  try {
    if (!stat) symlinkSync(wanted, path, "dir");
    else if (!stat.isSymbolicLink() || readlinkSync(path) !== wanted) {
      console.warn(`${at} exists and is not a link to pro/. Move it away and run pnpm install again.`);
    }
  } catch (error) {
    console.warn(`Could not link ${at}: ${error.message}`);
  }
}
