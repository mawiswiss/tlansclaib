import type { SpeakerBackend } from "./types";

export const DETECTION: Record<SpeakerBackend, { name: string; source: string; credit: string; counts: number[] }> = {
  sherpa: {
    name: "Basic speaker detection",
    source: "https://github.com/k2-fsa/sherpa-onnx",
    credit: "sherpa-onnx 1.13.8 with pyannote segmentation (MIT) and 3D-Speaker CAM++ (Apache 2.0).",
    counts: [2, 3, 4, 5, 6],
  },
  nemotron: {
    name: "Better speaker detection",
    source: "https://huggingface.co/nvidia/Nemotron-3-Diarization",
    credit: "Nemotron 3 Diarization by NVIDIA (OpenMDW 1.1), with the parakeet.cpp runtime (MIT).",
    counts: [2, 3, 4, 5, 6, 7, 8],
  },
};
