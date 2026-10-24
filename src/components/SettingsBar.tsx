import { DETECTION } from "../lib/detection";
import { FIT_LABEL, ramFit } from "../lib/fit";
import type { LanguageOption } from "../lib/setup";
import type { ModelStatus, SpeakerBackend, Stats } from "../lib/types";
import { languagesOf } from "./ModelsPanel";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";

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
  onSetUpSpeakers: () => void;
  stats: Stats | null;
  busy: boolean;
};

const SET_UP = "set-up";

export function SettingsBar(props: Props) {
  const { models, modelId, model, onModel, languages, language, onLanguage, locked, backend, stats, busy } = props;
  const installed = models.filter((m) => m.installed);
  const fit = model && stats ? ramFit(model.ram_gb, stats.memory_total) : null;
  const pill = fit && <span className={`fit ${fit.level}`}>{FIT_LABEL[fit.level]}</span>;
  const pinned = installed.some((m) => m.id === modelId) ? modelId : "auto";
  return (
    <section className="settings" aria-label="Transcription settings">
      <label className="setting" htmlFor="language-setting" title={locked ? "This model only knows one language" : undefined}>
        <span className="label">Recording language</span>
        <Select id="language-setting" value={locked ?? language} onChange={onLanguage} disabled={busy || locked !== null} label="Recording language" options={languages} />
      </label>
      <label className="setting" htmlFor="model-setting" title="Automatic takes the model of your setup for the language.">
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
              {selected?.value === "auto" && model && <span className="select-sub">{languagesOf(model)}</span>}
            </span>
          )}
          options={
            installed.length === 0
              ? [{ value: "", label: "No model installed" }]
              : [{ value: "auto", label: "Automatic" }, ...installed.map((m) => ({ value: m.id, label: m.custom ? `${m.name} (custom)` : m.name }))]
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
        </span>
        <Select
          id="speakers-setting"
          value={backend ? props.speakers : "off"}
          disabled={busy}
          label="Speakers"
          onChange={(value) => {
            if (value === SET_UP) props.onSetUpSpeakers();
            else props.onSpeakers(value);
          }}
          options={[
            { value: "off", label: "Disabled" },
            ...(backend
              ? [{ value: "auto", label: "Auto" }, ...DETECTION[backend].counts.map((n) => ({ value: String(n), label: backend === "nemotron" ? `Up to ${n} people` : `${n} people` }))]
              : [{ value: SET_UP, label: "Set up…" }]),
          ]}
        />
      </label>
    </section>
  );
}
