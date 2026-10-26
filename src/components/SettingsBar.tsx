import { DETECTION } from "../lib/detection";
import { failedFit, FIT_LABEL, ramFit } from "../lib/fit";
import type { LanguageOption } from "../lib/setup";
import type { ModelStatus, SpeakerBackend, Stats } from "../lib/types";
import { languagesOf, menuLabel } from "./ModelsPanel";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";

/** What the Speakers cell says and offers while no speaker detection works. */
export type SpeakerFix = { state: string; action: string | null; tip: string };

type Props = {
  models: ModelStatus[];
  modelId: string;
  model: ModelStatus | null;
  onModel: (id: string) => void;
  languages: LanguageOption[];
  language: string;
  onLanguage: (key: string) => void;
  locked: string | null;
  speakers: string;
  backend: SpeakerBackend | null;
  onSpeakers: (value: string) => void;
  speakerPrecision: "standard" | "fast";
  onSpeakerPrecision: (value: "standard" | "fast") => void;
  speakerFix: SpeakerFix | null;
  onFixSpeakers: () => void;
  stats: Stats | null;
  busy: boolean;
};

export function SettingsBar(props: Props) {
  const { models, modelId, model, onModel, languages, language, onLanguage, locked, backend, stats, busy } = props;
  const installed = models.filter((m) => m.installed);
  const fit = model?.too_heavy ? failedFit(model.too_heavy) : model && stats ? ramFit(model.ram_gb, stats.memory_total) : null;
  const pill = fit && <span className={`fit ${fit.level}`}>{model?.too_heavy ? "Failed here" : FIT_LABEL[fit.level]}</span>;
  const pinned = installed.some((m) => m.id === modelId) ? modelId : "auto";
  const fix = props.speakerFix;
  return (
    <section className="settings" aria-label="Transcription settings">
      <label className="setting" htmlFor="language-setting" title={locked ? "This model only knows one language" : undefined}>
        <span className="label">Recording language</span>
        <Select id="language-setting" value={locked ?? language} onChange={onLanguage} disabled={busy || locked !== null} label="Recording language" options={languages} />
      </label>
      <label className="setting" htmlFor="model-setting" title="Automatic takes the model of your setup for the language, or a better installed one while it fits the free memory.">
        <span className="label">
          Model
          {fit?.tip ? <Tooltip content={fit.tip}>{pill}</Tooltip> : pill}
        </span>
        <Select
          id="model-setting"
          value={installed.length === 0 ? "" : pinned}
          onChange={onModel}
          disabled={busy || installed.length === 0}
          label="Model"
          trigger={(selected) => (
            <span className="select-value">
              {selected?.label ?? ""}
              {selected?.value === "auto" && (model || installed.some((m) => m.too_heavy)) && <span className="select-sub">{model ? languagesOf(model) : "None that works here"}</span>}
            </span>
          )}
          options={
            installed.length === 0
              ? [{ value: "", label: "No model installed" }]
              : [{ value: "auto", label: "Automatic" }, ...installed.map((m) => ({ value: m.id, label: menuLabel(m) }))]
          }
        />
      </label>
      <label className="setting" htmlFor="speakers-setting" title="Name who speaks in a recording with one audio track. A recording with several tracks gets one speaker per track anyway.">
        <span className="label">
          Speakers
          {backend === "sherpa" && props.speakers !== "off" && (
            <Select
              className="precision"
              chevron={false}
              value={props.speakerPrecision}
              disabled={busy}
              onChange={(value) => props.onSpeakerPrecision(value as "standard" | "fast")}
              label="Precision of speaker detection"
              title="Standard places speaker changes to about a second. Fast takes about a third of the time and gets a few more changes wrong."
              options={[
                { value: "standard", label: "Standard" },
                { value: "fast", label: "Fast" },
              ]}
            />
          )}
          {!backend && fix?.action && (
            <Tooltip content={fix.tip}>
              <button type="button" className="setting-action" disabled={busy} onClick={props.onFixSpeakers}>
                {fix.action}
              </button>
            </Tooltip>
          )}
        </span>
        <Select
          id="speakers-setting"
          value={backend ? props.speakers : "off"}
          disabled={busy || !backend}
          label="Speakers"
          title={!backend && fix ? fix.tip : undefined}
          onChange={props.onSpeakers}
          options={[
            { value: "off", label: backend || !fix ? "Disabled" : fix.state },
            ...(backend ? [{ value: "auto", label: "Auto" }, ...DETECTION[backend].counts.map((n) => ({ value: String(n), label: backend === "nemotron" ? `Up to ${n} people` : `${n} people` }))] : []),
          ]}
        />
      </label>
    </section>
  );
}
