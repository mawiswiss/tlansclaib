#!/bin/sh
# Builds whisper.cpp v1.8.3 and binding.cpp to WebAssembly with SIMD and pthreads.
# usage: build.sh WHISPER_CPP_DIR OUT_DIR, with emsdk_env.sh sourced.
set -e
src=${1:?usage: build.sh WHISPER_CPP_DIR OUT_DIR}
out=${2:?usage: build.sh WHISPER_CPP_DIR OUT_DIR}
here=$(cd "$(dirname "$0")" && pwd)
build="$out/cmake"

# Emscripten reports x86 by default, which makes ggml fall back to its scalar kernels.
emcmake cmake -S "$src" -B "$build" -DCMAKE_BUILD_TYPE=Release -DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm32 \
    -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    -DGGML_OPENMP=OFF
cmake --build "$build" --target whisper -j

em++ -O3 -msimd128 -pthread -std=c++17 \
    -I "$src/include" -I "$src/ggml/include" \
    "$here/binding.cpp" \
    "$build/src/libwhisper.a" "$build/ggml/src/libggml.a" \
    "$build/ggml/src/libggml-base.a" "$build/ggml/src/libggml-cpu.a" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker \
    -sPTHREAD_POOL_SIZE=8 \
    -sINITIAL_MEMORY=256MB -sMAXIMUM_MEMORY=4GB -sALLOW_MEMORY_GROWTH=1 \
    -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_FUNCTIONS=_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=FS,cwrap,HEAPF32 \
    -o "$out/whisper.mjs"
