import { FIT_LABEL, ramFit } from "../lib/fit";
import { capitalize, fileName } from "../lib/format";
import type { Language, ModelStatus, Stats } from "../lib/types";
import { Folder } from "./icons";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";

type Props = {
  models: ModelStatus[];
  modelId: string;
  onModel: (id: string) => void;
  languages: Language[];
  language: string;
  onLanguage: (code: string) => void;
  locked: string | null;
  outputDir: string | null;
  onOutputDir: (dir: string | null) => void;
  onChooseOutputDir: () => void;
  speakers: string;
  detection: boolean;
  onSpeakers: (value: string) => void;
  speakerPrecision: "standard" | "fast";
  onSpeakerPrecision: (value: "standard" | "fast") => void;
  onSetUpSpeakers: () => void;
  stats: Stats | null;
  busy: boolean;
};

const CHOOSE = "choose";
const SET_UP = "set-up";
const COUNTS = [2, 3, 4, 5, 6];

export function SettingsBar(props: Props) {
  const { models, modelId, onModel, languages, language, onLanguage, locked, stats, busy } = props;
  const installed = models.filter((m) => m.installed);
  const selected = installed.find((m) => m.id === modelId);
  const fit = selected && stats ? ramFit(selected.ram_gb, stats.memory_total) : null;
  const pill = fit && <span className={`fit ${fit.level}`}>{FIT_LABEL[fit.level]}</span>;
  const sorted = [...languages].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="settings" aria-label="Transcription settings">
      <label className="setting" htmlFor="model-setting">
        <span className="label">
          Model
          {fit?.tip ? <Tooltip content={fit.tip}>{pill}</Tooltip> : pill}
        </span>
        <Select
          id="model-setting"
          value={modelId}
          onChange={onModel}
          disabled={busy || installed.length === 0}
          label="Model"
          options={
            installed.length === 0
              ? [{ value: "", label: "No model installed" }]
              : installed.map((m) => ({ value: m.id, label: m.custom ? `${m.name} (custom)` : m.name }))
          }
        />
      </label>
      <label className="setting" htmlFor="language-setting" title={locked ? "This model only knows one language" : undefined}>
        <span className="label">Language</span>
        <Select
          id="language-setting"
          value={locked ?? language}
          onChange={onLanguage}
          disabled={busy || locked !== null}
          label="Language"
          options={[{ value: "auto", label: "Auto" }, ...sorted.map((l) => ({ value: l.code, label: capitalize(l.name) }))]}
        />
      </label>
      <label
        className="setting"
        htmlFor="speakers-setting"
        title="Name who speaks in a recording with one audio track. A recording with several tracks gets one speaker per track anyway."
      >
        <span className="label">
          Speakers
          {props.detection && props.speakers !== "off" && (
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
          value={props.detection ? props.speakers : "off"}
          disabled={busy}
          label="Speakers"
          onChange={(value) => {
            if (value === SET_UP) props.onSetUpSpeakers();
            else props.onSpeakers(value);
          }}
          options={[
            { value: "off", label: "Disabled" },
            ...(props.detection
              ? [{ value: "auto", label: "Auto" }, ...COUNTS.map((n) => ({ value: String(n), label: `${n} people` }))]
              : [{ value: SET_UP, label: "Set up…" }]),
          ]}
        />
      </label>
      <div className={`setting icon-setting${props.outputDir ? " custom" : ""}`}>
        <Select
          className="icon-trigger"
          chevron={false}
          value={props.outputDir ?? ""}
          disabled={busy}
          label="Save to"
          title={`Save to: ${props.outputDir ?? "next to the recording"}`}
          trigger={() => <Folder size={19} />}
          onChange={(value) => {
            if (value === CHOOSE) props.onChooseOutputDir();
            else props.onOutputDir(value || null);
          }}
          options={[
            { value: "", label: "Next to the recording" },
            ...(props.outputDir ? [{ value: props.outputDir, label: fileName(props.outputDir) }] : []),
            { value: CHOOSE, label: "Choose a folder…" },
          ]}
        />
      </div>
    </section>
  );
}
