import { describe, expect, it } from "vitest";
import { agreed, betterDownload, defaultModel, downloadOrder, fittingDownload, fittingInstalled, leftovers, missingBytes, modelFor, parseLanguage, recommend, runLanguages, setupChanges, setupLanguages, smallerModel, wanted, wantedBackend, type Resources, type Setup } from "./setup";
import type { Gpu, ModelStatus, SpeakerDetection } from "./types";

const GIB = 2 ** 30;

function model(id: string, languages: string[], setups: string[] | null, extra: Partial<ModelStatus> = {}): ModelStatus {
  return {
    id, name: id, languages, language_name: null, setups, recommended: "", file: `ggml-${id}.bin`, size_bytes: GIB, sha256: null, ram_gb: 1,
    url: "https://example.invalid", architecture: null, quantization: null, source: null, license: null, installed: false, path: null, label: null,
    custom: false, linked: false, ...extra,
  };
}

const models = [
  model("thai-fast", ["th"], ["essential"], { quality: 1 }),
  model("thai-best", ["th"], ["precise"], { quality: 2 }),
  model("german-fast", ["de"], ["essential"], { quality: 1 }),
  model("swiss-german", ["de"], ["essential", "precise"], { language_name: "Swiss German", quality: 1 }),
  model("turbo-q8", ["all"], ["essential"], { quality: 2 }),
  model("large-v3", ["all"], ["precise"], { size_bytes: 3 * GIB, ram_gb: 4, quality: 5 }),
  model("tiny", ["all"], ["minimal"], { quality: 1 }),
  model("base", ["all"], null),
];

const detections: SpeakerDetection[] = [
  { backend: "sherpa", available: true, installed: false, downloading: false, download_bytes: 38e6, disk_bytes: 0 },
  { backend: "nemotron", available: true, installed: false, downloading: false, download_bytes: 202e6, disk_bytes: 0 },
];

const setup = (mode: Setup["mode"], key = "auto", changes: Partial<Setup> = {}): Setup => ({ mode, language: parseLanguage(key), added: [], removed: [], ...changes });

const with_ = (installed: string[]) => models.map((m) => ({ ...m, installed: installed.includes(m.id) }));

const gpu: Gpu = { backend: "metal", name: "Apple M5", free_bytes: null, usable: true };

const plenty: Resources = { budget: 8 * GIB, gpu };

describe("wanted", () => {
  it("takes the mode's all-language model and speaker detection", () => {
    expect(wanted(models, setup("essential"))).toEqual(["turbo-q8", "speaker-detection-nemotron"]);
    expect(wanted(models, setup("precise"))).toEqual(["large-v3", "speaker-detection-nemotron"]);
    expect(wanted(models, setup("minimal"))).toEqual(["tiny", "speaker-detection"]);
  });

  it("adds the chosen language's model, and German never pulls in Swiss German", () => {
    expect(wanted(models, setup("essential", "de"))).toEqual(["german-fast", "turbo-q8", "speaker-detection-nemotron"]);
    expect(wanted(models, setup("precise", "de|Swiss German"))).toEqual(["swiss-german", "large-v3", "speaker-detection-nemotron"]);
    expect(wanted(models, setup("precise", "de"))).toEqual(["large-v3", "speaker-detection-nemotron"]);
  });

  it("keeps what a technical user added or removed by hand", () => {
    expect(wanted(models, setup("essential", "th", { added: ["base"], removed: ["speaker-detection-nemotron"] }))).toEqual(["thai-fast", "turbo-q8", "base"]);
  });
});

describe("setupChanges", () => {
  it("holds back a member a newer model list adds until the user agrees", () => {
    const old = setup("precise", "th", { accepted: ["large-v3", "speaker-detection-nemotron", "thai-fast"] });
    const listed = models.map((m) => (m.id === "thai-fast" ? { ...m, setups: [], installed: true } : m));
    expect(agreed(listed, old)).toEqual(["speaker-detection-nemotron", "large-v3"]);
    expect(setupChanges(listed, detections, old)).toEqual({ fresh: ["thai-best"], dropped: ["thai-fast"] });
    const yes = { ...old, accepted: [...old.accepted!, "thai-best"] };
    expect(agreed(listed, yes)).toEqual(["thai-best", "speaker-detection-nemotron", "large-v3"]);
    expect(setupChanges(listed, detections, yes).fresh).toEqual([]);
  });

  it("counts every member as agreed in a setup saved before the snapshot", () => {
    expect(agreed(models, setup("essential"))).toEqual(downloadOrder(models, setup("essential")));
    expect(setupChanges(models, detections, setup("essential"))).toEqual({ fresh: [], dropped: [] });
  });

  it("offers nothing for a new member that is installed already", () => {
    const old = setup("precise", "th", { accepted: ["large-v3", "speaker-detection-nemotron"] });
    expect(setupChanges(with_(["thai-best"]), detections, old).fresh).toEqual([]);
  });
});

describe("modelFor", () => {
  it("picks the Swiss German model for Swiss German", () => {
    const installed = with_(["swiss-german", "german-fast", "large-v3"]);
    expect(modelFor(installed, setup("precise", "de|Swiss German"), parseLanguage("de|Swiss German"))?.id).toBe("swiss-german");
    expect(modelFor(installed, setup("precise", "de|Swiss German"), parseLanguage("de"))?.id).toBe("german-fast");
  });

  it("falls back to the all-language model for an uninstalled language model and for Auto", () => {
    const installed = with_(["large-v3", "tiny"]);
    expect(modelFor(installed, setup("precise", "th"), parseLanguage("th"))?.id).toBe("large-v3");
    expect(modelFor(installed, setup("precise", "th"), parseLanguage("auto"))?.id).toBe("large-v3");
    expect(modelFor(installed, setup("minimal"), parseLanguage("auto"))?.id).toBe("tiny");
  });

  it("skips a model that failed here unless it is pinned", () => {
    const installed = with_(["thai-fast", "turbo-q8"]).map((m) => (m.id === "thai-fast" ? { ...m, too_heavy: "Memory ran low while it loaded." } : m));
    expect(modelFor(installed, setup("essential", "th"), parseLanguage("th"))?.id).toBe("turbo-q8");
    expect(modelFor(installed, setup("essential", "th"), parseLanguage("th"), "thai-fast")?.id).toBe("thai-fast");
    const allFailed = installed.map((m) => ({ ...m, too_heavy: "It could not be loaded." }));
    expect(modelFor(allFailed, setup("essential", "th"), parseLanguage("th"))).toBeNull();
  });

  it("respects a pinned model and ignores one that is gone", () => {
    const installed = with_(["large-v3", "tiny"]);
    expect(modelFor(installed, setup("precise"), parseLanguage("auto"), "tiny")?.id).toBe("tiny");
    expect(modelFor(installed, setup("precise"), parseLanguage("auto"), "thai-best")?.id).toBe("large-v3");
    expect(modelFor(with_([]), null, parseLanguage("auto"))).toBeNull();
  });
});

describe("stepping up", () => {
  it("takes a better installed model of the same kind when it runs well", () => {
    const installed = with_(["turbo-q8", "large-v3", "thai-fast", "thai-best"]);
    expect(modelFor(installed, setup("essential"), parseLanguage("auto"), "auto", plenty)?.id).toBe("large-v3");
    expect(modelFor(installed, setup("essential", "th"), parseLanguage("th"), "auto", plenty)?.id).toBe("thai-best");
  });

  it("never trades a language's own model for one for all languages", () => {
    expect(modelFor(with_(["german-fast", "large-v3"]), setup("essential", "de"), parseLanguage("de"), "auto", plenty)?.id).toBe("german-fast");
  });

  it("keeps the setup's model when free RAM, GPU memory or the GPU fall short", () => {
    const pick = (resources: Resources | null) => modelFor(with_(["turbo-q8", "large-v3"]), setup("essential"), parseLanguage("auto"), "auto", resources)?.id;
    expect(pick({ budget: 4 * GIB, gpu })).toBe("large-v3");
    expect(pick({ budget: 4 * GIB - 1, gpu })).toBe("turbo-q8");
    expect(pick({ budget: 8 * GIB, gpu: { ...gpu, model_budget: 3 * GIB } })).toBe("turbo-q8");
    expect(pick({ budget: 8 * GIB, gpu: { ...gpu, usable: false } })).toBe("turbo-q8");
    expect(pick(null)).toBe("turbo-q8");
  });

  it("never steps up to a custom model or one that failed here, nor past a pinned one", () => {
    const failed = with_(["turbo-q8", "large-v3"]).map((m) => (m.id === "large-v3" ? { ...m, too_heavy: "Memory ran low while it loaded." } : m));
    expect(modelFor(failed, setup("essential"), parseLanguage("auto"), "auto", plenty)?.id).toBe("turbo-q8");
    const custom = [...with_(["turbo-q8"]), model("mine", ["all"], null, { quality: 9, custom: true, installed: true })];
    expect(modelFor(custom, setup("essential"), parseLanguage("auto"), "auto", plenty)?.id).toBe("turbo-q8");
    expect(modelFor(with_(["turbo-q8", "large-v3"]), setup("essential"), parseLanguage("auto"), "turbo-q8", plenty)?.id).toBe("turbo-q8");
  });
});

describe("betterDownload", () => {
  it("offers the best model that would run well and beat the current choice", () => {
    expect(betterDownload(with_(["turbo-q8"]), setup("essential"), parseLanguage("auto"), plenty)?.id).toBe("large-v3");
    expect(betterDownload(with_(["turbo-q8"]), setup("essential"), parseLanguage("auto"), { budget: 2 * GIB, gpu })).toBeNull();
    expect(betterDownload(with_(["large-v3"]), setup("precise"), parseLanguage("auto"), plenty)).toBeNull();
    expect(betterDownload(with_(["turbo-q8"]), setup("essential"), parseLanguage("auto"), null)).toBeNull();
    expect(betterDownload(with_([]), setup("essential"), parseLanguage("auto"), plenty)).toBeNull();
  });

  it("offers a language's own model before a larger one for all languages", () => {
    expect(betterDownload(with_(["turbo-q8"]), setup("essential", "th"), parseLanguage("th"), plenty)?.id).toBe("thai-best");
    expect(betterDownload(with_(["thai-fast", "turbo-q8"]), setup("essential", "th"), parseLanguage("th"), plenty)?.id).toBe("thai-best");
  });
});

describe("downloads", () => {
  it("fetches the language's model first, then speaker detection", () => {
    expect(defaultModel(models, setup("essential", "th"))?.id).toBe("thai-fast");
    expect(downloadOrder(models, setup("essential", "th"))).toEqual(["thai-fast", "speaker-detection-nemotron", "turbo-q8"]);
    expect(downloadOrder(models, setup("precise"))).toEqual(["large-v3", "speaker-detection-nemotron"]);
  });

  it("counts only what is not installed yet", () => {
    const ids = wanted(models, setup("precise"));
    expect(missingBytes(ids, models, detections)).toBe(3 * GIB + 202e6);
    expect(missingBytes(ids, with_(["large-v3"]), detections)).toBe(202e6);
  });

  it("lists leftovers after switching down, never custom or linked files", () => {
    const installed = [...with_(["large-v3", "turbo-q8", "thai-best"]), model("custom:mine", ["all"], null, { installed: true, custom: true }), model("linked:abc", ["all"], null, { installed: true, custom: true, linked: true })];
    const both = detections.map((d) => ({ ...d, installed: true }));
    expect(leftovers(installed, both, setup("essential"))).toEqual(["thai-best", "large-v3", "speaker-detection"]);
  });

  it("runs the setup's speaker detection when installed, else the other", () => {
    const both = detections.map((d) => ({ ...d, installed: true }));
    expect(wantedBackend(setup("essential"), both)).toBe("nemotron");
    expect(wantedBackend(setup("minimal"), both)).toBe("sherpa");
    expect(wantedBackend(setup("essential"), [{ ...detections[0], installed: true }, detections[1]])).toBe("sherpa");
    expect(wantedBackend(null, detections)).toBeNull();
    expect(wantedBackend(setup("essential"), [{ ...detections[0], installed: true }, { ...detections[1], installed: true, broken: "a part is missing" }])).toBe("sherpa");
    expect(wantedBackend(setup("essential"), [detections[0], { ...detections[1], installed: true, broken: "a part is missing" }])).toBeNull();
  });
});

describe("recommend", () => {
  const base = { speed: 50e6, gpu, memoryTotal: 32 * GIB, preciseBytes: 3.3e9, preciseRamGb: 4, preciseModel: null };

  it("recommends Precise with a GPU, enough memory and a fast line", () => {
    expect(recommend(base)).toBe("precise");
  });

  it("keeps Precise on a 16 GB Windows PC and when the download takes under 30 minutes", () => {
    expect(recommend({ ...base, memoryTotal: 15.7 * GIB })).toBe("precise");
    expect(recommend({ ...base, speed: 2e6 })).toBe("precise");
  });

  it("recommends Essential without a GPU, offline, on a slow line or with little memory", () => {
    expect(recommend({ ...base, gpu: { ...gpu, backend: null, usable: false } })).toBe("essential");
    expect(recommend({ ...base, speed: "offline" })).toBe("essential");
    expect(recommend({ ...base, speed: 1.5e6 })).toBe("essential");
    expect(recommend({ ...base, memoryTotal: 8 * GIB })).toBe("essential");
    expect(recommend({ ...base, memoryTotal: 12 * GIB })).toBe("essential");
  });

  it("recommends Essential when the Precise model failed on this computer", () => {
    const failed = model("large-v3", ["all"], ["precise"], { installed: true, too_heavy: "It crashed on this computer." });
    expect(recommend({ ...base, preciseModel: failed })).toBe("essential");
    expect(recommend({ ...base, preciseModel: { ...failed, too_heavy: null } })).toBe("precise");
    expect(recommend({ ...base, preciseModel: { ...failed, installed: false } })).toBe("precise");
  });

  it("waits while measuring and never recommends Minimal", () => {
    expect(recommend({ ...base, speed: "measuring" })).toBeNull();
    expect(recommend({ ...base, gpu: null })).toBeNull();
    const cases = [50e6, 1e5, "offline" as const].flatMap((speed) => [8, 16, 64].map((gb) => recommend({ ...base, speed, memoryTotal: gb * GIB })));
    expect(cases).not.toContain("minimal");
  });
});

describe("languages", () => {
  const whisper = [{ code: "en", name: "english" }, { code: "de", name: "german" }, { code: "th", name: "thai" }, { code: "it", name: "italian" }];

  it("lists several languages, then those with their own model, then the rest", () => {
    expect(setupLanguages(models, whisper).map((o) => o.label)).toEqual(["Several languages", "German", "Swiss German", "Thai", "English", "Italian"]);
  });

  it("offers Swiss German in the settings row once its model is installed", () => {
    expect(runLanguages(models, whisper).map((o) => o.value)).not.toContain("de|Swiss German");
    expect(runLanguages(with_(["swiss-german"]), whisper).map((o) => o.value)).toEqual(["auto", "en", "de", "it", "de|Swiss German", "th"]);
  });
});

describe("a model that fits the free memory", () => {
  const thai = parseLanguage("th");
  const list = [
    model("thai-fast", ["th"], ["essential"], { quality: 1, ram_gb: 1.3, installed: true }),
    model("thai-best", ["th"], ["precise"], { quality: 2, ram_gb: 2.4, installed: true }),
    model("turbo-q8", ["all"], ["essential"], { quality: 3, ram_gb: 1.3, installed: true }),
    model("large-v3", ["all"], ["precise"], { quality: 6, ram_gb: 4 }),
    model("small", ["all"], ["minimal"], { quality: 1, ram_gb: 0.7 }),
  ];

  it("keeps the language's own model and takes the best that fits", () => {
    expect(fittingInstalled(list, thai, 3 * GIB)?.id).toBe("thai-best");
    expect(fittingInstalled(list, thai, 2 * GIB)?.id).toBe("thai-fast");
  });

  it("falls back to a model for all languages, never one that failed here", () => {
    expect(fittingInstalled(list, parseLanguage("de"), 2 * GIB)?.id).toBe("turbo-q8");
    const failed = list.map((m) => (m.id === "thai-fast" ? { ...m, too_heavy: "Memory ran low." } : m));
    expect(fittingInstalled(failed, thai, 2 * GIB)?.id).toBe("turbo-q8");
    expect(fittingInstalled(list, thai, GIB)).toBeNull();
  });

  it("offers the best download that fits", () => {
    expect(fittingDownload(list, thai, GIB)?.id).toBe("small");
    expect(fittingDownload(list, thai, 5 * GIB)?.id).toBe("large-v3");
    expect(fittingDownload(list, thai, GIB / 2)).toBeNull();
  });
});

describe("smallerModel", () => {
  const sized = models.map((m) => ({ ...m, ram_gb: { "thai-fast": 1.3, "thai-best": 4, "turbo-q8": 1.7, "large-v3": 4, tiny: 0.7, base: 0.9 }[m.id] ?? 1 }));

  it("finds the language's own lighter model first, then one for all languages", () => {
    const best = sized.find((m) => m.id === "thai-best")!;
    expect(smallerModel(sized, best, parseLanguage("th"))?.id).toBe("thai-fast");
    const fast = sized.find((m) => m.id === "thai-fast")!;
    expect(smallerModel(sized, fast, parseLanguage("th"))?.id).toBe("tiny");
  });

  it("finds none for the smallest model", () => {
    const tiny = sized.find((m) => m.id === "tiny")!;
    expect(smallerModel(sized, tiny, parseLanguage("auto"))).toBeNull();
    expect(smallerModel(sized.map((m) => (m.id === "tiny" || m.id === "base" ? { ...m, too_heavy: "It could not be loaded." } : m)), sized.find((m) => m.id === "thai-fast")!, parseLanguage("th"))).toBeNull();
  });
});
