import { downloadSeconds, ramFit } from "./fit";
import type { Gpu, Language, ModelStatus, SpeakerBackend, SpeakerDetection } from "./types";

export type Mode = "precise" | "essential" | "minimal";

export const MODES: Mode[] = ["precise", "essential", "minimal"];

export const MODE_NAMES: Record<Mode, string> = { precise: "Precise", essential: "Essential", minimal: "Minimal" };

export const MODE_DETECTION: Record<Mode, SpeakerBackend | null> = { precise: "nemotron", essential: "sherpa", minimal: null };

export const DETECTION_IDS: Record<SpeakerBackend, string> = { sherpa: "speaker-detection", nemotron: "speaker-detection-nemotron" };

export type SetupLanguage = { code: string; variant: string | null };

export type Setup = { mode: Mode; language: SetupLanguage; added: string[]; removed: string[] };

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

export function wantedBackend(setup: Setup | null, detections: SpeakerDetection[]): SpeakerBackend | null {
  const installed = detections.filter((d) => d.installed).map((d) => d.backend);
  const preferred = setup ? MODE_DETECTION[setup.mode] : null;
  if (preferred && installed.includes(preferred)) return preferred;
  return installed.includes("nemotron") ? "nemotron" : installed.includes("sherpa") ? "sherpa" : null;
}

/** The model Automatic uses for a language: its own model, otherwise one for all languages. Setup members come first. */
export function modelFor(models: ModelStatus[], setup: Setup | null, language: SetupLanguage, pinned = "auto"): ModelStatus | null {
  const installed = models.filter((m) => m.installed);
  if (pinned !== "auto") {
    const chosen = installed.find((m) => m.id === pinned);
    if (chosen) return chosen;
  }
  const member = (m: ModelStatus) => (setup ? wanted(models, setup).includes(m.id) : false);
  const best = (list: ModelStatus[]) => list.find(member) ?? list[0] ?? null;
  return best(installed.filter((m) => speaks(m, language))) ?? best(installed.filter(multilingual));
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

export type Recommendation = { speed: number | "measuring" | "offline"; gpu: Gpu | null; memoryTotal: number | null; preciseBytes: number; preciseRamGb: number };

export function recommend({ speed, gpu, memoryTotal, preciseBytes, preciseRamGb }: Recommendation): Mode | null {
  if (speed === "measuring" || gpu === null || memoryTotal === null) return null;
  if (speed === "offline" || !gpu.usable || memoryTotal < PRECISE_MEMORY) return "essential";
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
