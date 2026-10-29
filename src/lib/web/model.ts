export type Pinned = { url: string; size: number; sha256: string };

export const MODEL_ID = "onnx-community/whisper-large-v3-turbo";
export const REVISION = "360ebcde2559d60bb474678be3c1de9ef347d01a";
export const DTYPE = { encoder_model: "q4f16", decoder_model_merged: "q4f16" } as const;
export const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";

const hf = (file: string) => `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}`;

export const FILES: Pinned[] = [
  { url: hf("config.json"), size: 1332, sha256: "35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1" },
  { url: hf("generation_config.json"), size: 3897, sha256: "16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f" },
  { url: hf("preprocessor_config.json"), size: 340, sha256: "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711" },
  { url: hf("tokenizer.json"), size: 2480617, sha256: "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca" },
  { url: hf("tokenizer_config.json"), size: 282843, sha256: "844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389" },
  { url: hf("onnx/encoder_model_q4f16.onnx"), size: 369974078, sha256: "aafd3383f1aa372db0825a885730ebbbae7e34871ec0460428663c69641a63d0" },
  { url: hf("onnx/decoder_model_merged_q4f16.onnx"), size: 193505017, sha256: "45981cdd958a4c8e1447839850d2e6e27e30974ccbe31b4a1e5ebe9ad8965a5f" },
  {
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
    size: 26861777,
    sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082",
  },
];

export const ORT_WASM = FILES[FILES.length - 1];

export const DOWNLOAD_BYTES = FILES.reduce((sum, f) => sum + f.size, 0);

/** Peak of the renderer plus the GPU process for q4f16, measured in `docs/browser.md`. */
export const PEAK_BYTES = (2272 + 1973) * 2 ** 20;

export const FOLDER = "tlansclaib-model-v1";

export const LIMIT_SECONDS = 600;

/** The browser reads the whole file into memory before it decodes. */
export const LARGEST_FILE_BYTES = 2 ** 30;
