// Builds the engine's line cutting for the browser version into src/lib/web/engine.wasm.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";

execFileSync("cargo", ["build", "-p", "tlansclaib-engine-wasm", "--release", "--target", "wasm32-unknown-unknown"], { stdio: "inherit" });
copyFileSync("target/wasm32-unknown-unknown/release/tlansclaib_engine_wasm.wasm", "src/lib/web/engine.wasm");
