#!/bin/sh
# Runs every configuration in a fresh Chrome against a running serve.mjs on port 8787.
# usage: run-all.sh RESULTS_DIR
set -e
out=${1:?usage: run-all.sh RESULTS_DIR}
cd "$(dirname "$0")"
base=http://127.0.0.1:8787
run() { node run.mjs "$base/$2" "$out/$1.json" | grep -v '^\[page\]'; }
run wasm-q5_0 'wasm.html?model=ggml-large-v3-turbo-q5_0.bin&threads=4&runs=2'
run wasm-q8_0 'wasm.html?model=ggml-large-v3-turbo-q8_0.bin&threads=4&runs=2'
run tjs-webgpu-fp16-q4 'tjs.html?device=webgpu&encoder=fp16&decoder=q4&runs=2'
run tjs-webgpu-q4f16 'tjs.html?device=webgpu&encoder=q4f16&decoder=q4f16&runs=2'
run tjs-wasm-q8 'tjs.html?device=wasm&encoder=q8&decoder=q8&threads=4&runs=2'
