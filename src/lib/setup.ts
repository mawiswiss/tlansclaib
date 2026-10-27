import { downloadSeconds, ramFit } from "./fit";
import type { Gpu, Language, ModelStatus, SpeakerBackend, SpeakerDetection } from "./types";

export type Mode = "precise" | "essential" | "minimal";

export const MODES: Mode[] = ["precise", "essential", "minimal"];

export const MODE_NAMES: Record<Mode, string> = { precise: "Precise", essential: "Essential", minimal: "Minimal" };

export const MODE_DETECTION: Record<Mode, SpeakerBackend | null> = { precise: "nemotron", essential: "nemotron", minimal: "sherpa" };

export const DETECTION_IDS: Record<SpeakerBackend, string> = { sherpa: "speaker-detection", nemotron: "speaker-detection-nemotron" };

export type SetupLanguage = { code: string; variant: string | null };

/** `accepted` holds the members the user agreed to download. Without it, every member counts. */
export type Setup = { mode: Mode; language: SetupLanguage; added: string[]; removed: string[]; accepted?: string[] };

export const SEVERAL: SetupLanguage = { code: "auto", variant: null };

const GIB = 2 ** 30;
const PRECISE_DOWNLOAD_SECONDS = 1800;
// Windows reports RAM minus what the hardware reserves, so a 16 GB PC shows less.
const PRECISE_MEMORY = 14 * GIB;

export function languageKey(language: SetupLanguage): string {
  return language.variant ? `${language.code}|${language.variant}` : language.code;
}

export function parseLanguage(key: string): SetupLanguage {
  const [code, variant] = key.split("|");
  return { code, variant: variant || null };
}

function multilingual(m: ModelStatus): boolean {
  return m.languages.includes("all");
}

export function speaks(m: ModelStatus, language: SetupLanguage): boolean {
  return language.code !== "auto" && m.languages.includes(language.code) && (m.language_name ?? null) === language.variant;
}

export function inMode(m: ModelStatus, mode: Mode, language: SetupLanguage): boolean {
  return !m.custom && (m.setups ?? []).includes(mode) && (multilingual(m) || speaks(m, language));
}

/** Model and speaker detection ids the setup asks for. */
export function wanted(models: ModelStatus[], setup: Setup): string[] {
  const ids = models.filter((m) => inMode(m, setup.mode, setup.language)).map((m) => m.id);
  const detection = MODE_DETECTION[setup.mode];
  if (detection) ids.push(DETECTION_IDS[detection]);
  for (const id of setup.added) if (!ids.includes(id)) ids.push(id);
  return ids.filter((id) => !setup.removed.includes(id));
}

/** The speaker detection a run uses: the setup's when it works here, otherwise the other one. */
export function wantedBackend(setup: Setup | null, detections: SpeakerDetection[]): SpeakerBackend | null {
  const installed = detections.filter((d) => d.installed && !d.broken).map((d) => d.backend);
  const preferred = setup ? MODE_DETECTION[setup.mode] : null;
  if (preferred && installed.includes(preferred)) return preferred;
  return installed.includes("nemotron") ? "nemotron" : installed.includes("sherpa") ? "sherpa" : null;
}

/** Free RAM and GPU right now. Without them, Automatic keeps the setup's model. */
export type Resources = { budget: number; gpu: Gpu };

function runsWell(m: ModelStatus, resources: Resources): boolean {
  const need = m.ram_gb * GIB;
  return resources.gpu.usable && need <= resources.budget && need <= (resources.gpu.model_budget ?? Infinity);
}

function rank(m: ModelStatus): number {
  return m.quality ?? 0;
}

function better(list: ModelStatus[], than: ModelStatus | null, resources: Resources | null): ModelStatus | null {
  if (!resources) return null;
  const floor = than ? rank(than) : -1;
  return list.filter((m) => !m.custom && rank(m) > floor && runsWell(m, resources)).reduce<ModelStatus | null>((top, m) => (top && rank(top) >= rank(m) ? top : m), null);
}

/** The model Automatic uses for a language: its own model, otherwise one for all languages. Setup members come first, models that failed here never, and a better installed one replaces it when it runs well right now. */
export function modelFor(models: ModelStatus[], setup: Setup | null, language: SetupLanguage, pinned = "auto", resources: Resources | null = null): ModelStatus | null {
  const installed = models.filter((m) => m.installed);
  if (pinned !== "auto") {
    const chosen = installed.find((m) => m.id === pinned);
    if (chosen) return chosen;
  }
  const usable = installed.filter((m) => !m.too_heavy);
  const member = (m: ModelStatus) => (setup ? wanted(models, setup).includes(m.id) : false);
  const best = (list: ModelStatus[]) => {
    const base = list.find(member) ?? list[0] ?? null;
    return base && (better(list, base, resources) ?? base);
  };
  return best(usable.filter((m) => speaks(m, language))) ?? best(usable.filter(multilingual));
}

/** A model to download that Automatic would take over its current choice, on this computer right now. */
export function betterDownload(models: ModelStatus[], setup: Setup | null, language: SetupLanguage, resources: Resources | null): ModelStatus | null {
  const current = modelFor(models, setup, language, "auto", resources);
  if (!current) return null;
  const offered = models.filter((m) => !m.installed && !m.too_heavy && m.url);
  const own = offered.filter((m) => speaks(m, language));
  if (speaks(current, language)) return better(own, current, resources);
  return better(own, null, resources) ?? better(offered.filter(multilingual), current, resources);
}

function largest(list: ModelStatus[]): ModelStatus | null {
  return list.reduce<ModelStatus | null>((top, m) => (top && (rank(top) > rank(m) || (rank(top) === rank(m) && top.ram_gb >= m.ram_gb)) ? top : m), null);
}

function fitting(list: ModelStatus[], language: SetupLanguage, budget: number): ModelStatus | null {
  const fits = list.filter((m) => !m.too_heavy && m.ram_gb * GIB <= budget);
  return largest(fits.filter((m) => speaks(m, language))) ?? largest(fits.filter(multilingual));
}

/** The language's own models first, then those for all languages. Never one that failed here. */
export function fittingInstalled(models: ModelStatus[], language: SetupLanguage, budget: number): ModelStatus | null {
  return fitting(models.filter((m) => m.installed), language, budget);
}

export function fittingDownload(models: ModelStatus[], language: SetupLanguage, budget: number): ModelStatus | null {
  return fitting(models.filter((m) => !m.installed && m.url), language, budget);
}

/** The closest model with less RAM for the language, installed or to download. None means this one is the smallest. */
export function smallerModel(models: ModelStatus[], than: ModelStatus, language: SetupLanguage): ModelStatus | null {
  const lighter = models.filter((m) => m.id !== than.id && !m.too_heavy && (m.installed || m.url) && m.ram_gb < than.ram_gb);
  return largest(lighter.filter((m) => speaks(m, language))) ?? largest(lighter.filter(multilingual));
}

export function defaultModel(models: ModelStatus[], setup: Setup): ModelStatus | null {
  const ids = wanted(models, setup);
  const members = models.filter((m) => ids.includes(m.id));
  return members.find((m) => speaks(m, setup.language)) ?? members.find(multilingual) ?? null;
}

export function downloadOrder(models: ModelStatus[], setup: Setup): string[] {
  const ids = wanted(models, setup);
  const first = defaultModel(models, setup)?.id;
  const detections = Object.values(DETECTION_IDS);
  return [...ids.filter((id) => id === first), ...ids.filter((id) => detections.includes(id)), ...ids.filter((id) => id !== first && !detections.includes(id))];
}

/** The setup's download queue: members a newer model list added wait until the user agrees. */
export function agreed(models: ModelStatus[], setup: Setup): string[] {
  const ids = downloadOrder(models, setup);
  return setup.accepted ? ids.filter((id) => setup.accepted!.includes(id)) : ids;
}

/** What a newer model list changed: members to download that the user has not agreed to, and installed models it took out. */
export function setupChanges(models: ModelStatus[], detections: SpeakerDetection[], setup: Setup): { fresh: string[]; dropped: string[] } {
  const ids = wanted(models, setup);
  const accepted = setup.accepted ?? ids;
  return {
    fresh: missing(ids.filter((id) => !accepted.includes(id)), models, detections),
    dropped: accepted.filter((id) => !ids.includes(id) && installed(id, models, detections)),
  };
}

function detectionOf(id: string, detections: SpeakerDetection[]): SpeakerDetection | undefined {
  return detections.find((d) => DETECTION_IDS[d.backend] === id);
}

export function installed(id: string, models: ModelStatus[], detections: SpeakerDetection[]): boolean {
  return detectionOf(id, detections)?.installed ?? models.find((m) => m.id === id)?.installed ?? false;
}

export function missing(ids: string[], models: ModelStatus[], detections: SpeakerDetection[]): string[] {
  return ids.filter((id) => !installed(id, models, detections) && (detectionOf(id, detections)?.available ?? models.some((m) => m.id === id && m.url)));
}

export function sizeOf(id: string, models: ModelStatus[], detections: SpeakerDetection[]): number {
  const detection = detectionOf(id, detections);
  if (detection) return detection.installed ? detection.disk_bytes : detection.download_bytes;
  return models.find((m) => m.id === id)?.size_bytes ?? 0;
}

export function missingBytes(ids: string[], models: ModelStatus[], detections: SpeakerDetection[]): number {
  return missing(ids, models, detections).reduce((sum, id) => sum + sizeOf(id, models, detections), 0);
}

export function leftovers(models: ModelStatus[], detections: SpeakerDetection[], setup: Setup): string[] {
  const ids = wanted(models, setup);
  const listed = models.filter((m) => m.installed && !m.custom && !ids.includes(m.id)).map((m) => m.id);
  const detectionIds = detections.filter((d) => d.installed && !ids.includes(DETECTION_IDS[d.backend])).map((d) => DETECTION_IDS[d.backend]);
  return [...listed, ...detectionIds];
}

export type Recommendation = { speed: number | "measuring" | "offline"; gpu: Gpu | null; memoryTotal: number | null; preciseBytes: number; preciseRamGb: number; preciseModel: ModelStatus | null };

export function recommend({ speed, gpu, memoryTotal, preciseBytes, preciseRamGb, preciseModel }: Recommendation): Mode | null {
  if (speed === "measuring" || gpu === null || memoryTotal === null) return null;
  if (speed === "offline" || !gpu.usable || memoryTotal < PRECISE_MEMORY) return "essential";
  if (preciseModel?.installed && preciseModel.too_heavy) return "essential";
  if (ramFit(preciseRamGb, memoryTotal).level !== "ok") return "essential";
  return downloadSeconds(preciseBytes, speed) < PRECISE_DOWNLOAD_SECONDS ? "precise" : "essential";
}

export type LanguageOption = { value: string; label: string };

function nameOf(code: string, languages: Language[]): string {
  const name = languages.find((l) => l.code === code)?.name ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function variants(models: ModelStatus[], languages: Language[], only: (m: ModelStatus) => boolean): LanguageOption[] {
  const options: LanguageOption[] = [];
  for (const m of models.filter((m) => !m.custom && !multilingual(m) && only(m))) {
    for (const code of m.languages) {
      const value = languageKey({ code, variant: m.language_name ?? null });
      if (!options.some((o) => o.value === value)) options.push({ value, label: m.language_name ?? nameOf(code, languages) });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

export function setupLanguages(models: ModelStatus[], languages: Language[]): LanguageOption[] {
  const own = variants(models, languages, (m) => (m.setups ?? []).length > 0);
  const others = languages
    .filter((l) => !own.some((o) => o.value === l.code))
    .map((l) => ({ value: l.code, label: nameOf(l.code, languages) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: SEVERAL.code, label: "Several languages" }, ...own, ...others];
}

export function runLanguages(models: ModelStatus[], languages: Language[]): LanguageOption[] {
  const extra = variants(models, languages, (m) => m.installed && m.language_name !== null);
  const all = [...languages.map((l) => ({ value: l.code, label: nameOf(l.code, languages) })), ...extra].sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "auto", label: "Auto-detect" }, ...all];
}
