#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = "==3.12.*"
# dependencies = [
#     "huggingface_hub",
#     "numpy==2.5.4",
#     "torch==2.14.1",
#     "transformers==5.19.0",
# ]
# ///
"""Convert a Hugging Face Whisper model into whisper.cpp files.

Usage: convert-model.py REPO_ID NAME [--quant q8_0 q5_0] [--keep-f16]
Writes models/ggml-NAME-<quant>.bin and prints size, SHA-256 and a models.json snippet.
Needs git and cmake on the PATH. The whisper.cpp checkout and its quantize tool are
kept in the cache folder, so the second model converts faster than the first.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

WHISPER_CPP_TAG = "v1.9.5"
MEL_FILTERS = "https://raw.githubusercontent.com/openai/whisper/main/whisper/assets/mel_filters.npz"


def step(message):
    print(f"→ {message}", flush=True)


def run(args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def prepare_whisper_cpp(cache):
    src = cache / "whisper.cpp"
    if not src.is_dir():
        step(f"Cloning whisper.cpp {WHISPER_CPP_TAG}")
        run(["git", "clone", "--quiet", "--depth", "1", "--branch", WHISPER_CPP_TAG,
             "https://github.com/ggml-org/whisper.cpp.git", str(src)])
    quantize = src / "build" / "bin" / "whisper-quantize"
    if not quantize.is_file():
        step("Building whisper-quantize with CMake")
        run(["cmake", "-S", str(src), "-B", str(src / "build"), "-DCMAKE_BUILD_TYPE=Release",
             "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_SERVER=OFF", "-DGGML_METAL=OFF"])
        run(["cmake", "--build", str(src / "build"), "--config", "Release", "--target", "whisper-quantize", "-j", "8"])
    assets = cache / "whisper-assets" / "whisper" / "assets" / "mel_filters.npz"
    if not assets.is_file():
        step("Fetching the mel filter bank from openai/whisper")
        assets.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MEL_FILTERS, assets)
    return src, quantize, assets.parent.parent.parent


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("repo", help="Hugging Face repo id, for example biodatlab/distill-whisper-th-large-v3")
    parser.add_argument("name", help="file name stem, for example thai-fast")
    parser.add_argument("--quant", nargs="*", default=["q8_0", "q5_0"], help="quantizations to write")
    parser.add_argument("--keep-f16", action="store_true", help="also keep the unquantized f16 file")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "models")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache" / "tlansclaib-convert")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    step(f"Downloading {args.repo} from Hugging Face (cached after the first time)")
    model_dir = snapshot_download(args.repo, allow_patterns=["*.json", "*.txt", "*.safetensors"])
    src, quantize, whisper_repo = prepare_whisper_cpp(args.cache)

    work = args.cache / args.name
    work.mkdir(exist_ok=True)
    f16 = work / "ggml-model.bin"
    if not f16.is_file():
        step("Converting to ggml f16")
        run([sys.executable, str(src / "models" / "convert-h5-to-ggml.py"), model_dir, str(whisper_repo), str(work)])

    written = []
    if args.keep_f16:
        target = args.out / f"ggml-{args.name}.bin"
        shutil.copyfile(f16, target)
        written.append(("f16", target))
    for quant in args.quant:
        target = args.out / f"ggml-{args.name}-{quant}.bin"
        step(f"Quantizing to {quant}")
        run([str(quantize), str(f16), str(target), quant])
        written.append((quant, target))

    for quant, target in written:
        size = target.stat().st_size
        print(json.dumps({
            "file": target.name,
            "quantization": quant,
            "size_bytes": size,
            "size": f"{size / 1e9:.2f} GB",
            "sha256": sha256(target),
            "source": f"https://huggingface.co/{args.repo}",
        }, indent=2))


if __name__ == "__main__":
    main()
