// Builds the engine in release mode and places it where Tauri expects a sidecar:
// src-tauri/binaries/tlansclaib-engine-<target triple>[.exe]
// A universal macOS build compiles both Apple targets and joins them with lipo.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const targetDir = process.env.CARGO_TARGET_DIR || join(root, "target");
const dir = join(root, "src-tauri", "binaries");
mkdirSync(dir, { recursive: true });

function build(target, features = []) {
  const args = ["build", "--release", "-p", "tlansclaib-engine"];
  if (target !== host) args.push("--target", target);
  if (features.length) args.push("--features", features.join(","));
  execFileSync("cargo", args, { cwd: root, stdio: "inherit" });
  const ext = target.includes("windows") ? ".exe" : "";
  return join(targetDir, target === host ? "" : target, "release", `tlansclaib-engine${ext}`);
}

function place(built, target, name = "tlansclaib-engine") {
  const path = join(dir, `${name}-${target}${target.includes("windows") ? ".exe" : ""}`);
  copyFileSync(built, path);
  return path;
}

if (triple === "universal-apple-darwin") {
  // tauri-build checks for each slice's sidecar, the bundle takes the joined one.
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((target) => place(build(target), target));
  execFileSync("lipo", ["-create", "-output", join(dir, "tlansclaib-engine-universal-apple-darwin"), ...slices], { stdio: "inherit" });
} else {
  place(build(triple), triple);
  if (triple.includes("windows")) {
    place(build(triple, ["vulkan"]), triple, "tlansclaib-engine-vulkan");
  }
}
console.log(`sidecar ready for ${triple}`);
