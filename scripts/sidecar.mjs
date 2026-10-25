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

// Engines for CPUs older than AVX2. whisper-rs-sys passes GGML_* variables to CMake but does not rebuild when they change, hence a target folder each.
// Every flag is explicit, because ggml turns all of them off by default in a cross build.
const ISA_OFF = { GGML_NATIVE: "OFF", GGML_SSE42: "OFF", GGML_AVX: "OFF", GGML_AVX2: "OFF", GGML_FMA: "OFF", GGML_F16C: "OFF", GGML_BMI2: "OFF" };
const OLDER_CPUS = {
  avx: { ...ISA_OFF, GGML_SSE42: "ON", GGML_AVX: "ON" },
  sse: ISA_OFF,
};

function build(target, features = [], cpu = null) {
  const args = ["build", "--release", "-p", "tlansclaib-engine"];
  if (target !== host) args.push("--target", target);
  if (features.length) args.push("--features", features.join(","));
  const out = cpu ? join(targetDir, `cpu-${cpu}`) : targetDir;
  execFileSync("cargo", args, { cwd: root, stdio: "inherit", env: { ...process.env, ...OLDER_CPUS[cpu], CARGO_TARGET_DIR: out } });
  const ext = target.includes("windows") ? ".exe" : "";
  return join(out, target === host ? "" : target, "release", `tlansclaib-engine${ext}`);
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
    for (const cpu of Object.keys(OLDER_CPUS)) place(build(triple, [], cpu), triple, `tlansclaib-engine-${cpu}`);
  }
}
console.log(`sidecar ready for ${triple}`);
