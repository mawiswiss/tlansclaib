import { useEffect, useLayoutEffect, useState } from "react";
import { DETECTION } from "../lib/detection";
import { parseLanguage, type LanguageOption } from "../lib/setup";
import type { ModelStatus, SpeakerBackend } from "../lib/types";
import { Close, Retry } from "./icons";
import { menuLabel } from "./ModelsPanel";
import { Select } from "./Select";

export type RerunChoice = {
  modelId: string;
  language: string;
  speakers: string;
  precision: "standard" | "fast";
  backend: SpeakerBackend | null;
  timestamps: boolean;
};

type Props = {
  title: string;
  edited: boolean;
  tracks: number;
  models: ModelStatus[];
  languages: LanguageOption[];
  initial: RerunChoice;
  focus: "speakers" | "language" | null;
  missingModel: string | null;
  onSetUpDetection: () => void;
  onRun: (choice: RerunChoice) => void;
  onClose: () => void;
};

export function RerunDialog(props: Props) {
  const { models, languages, focus } = props;
  const [choice, setChoice] = useState<RerunChoice>(props.initial);
  const installed = models.filter((m) => m.installed);
  const model = installed.find((m) => m.id === choice.modelId);
  const locked = model && !model.languages.includes("all") ? (model.language_name ? `${model.languages[0]}|${model.language_name}` : model.languages[0]) : null;
  const backend = choice.backend;
  const set = (patch: Partial<RerunChoice>) => setChoice((c) => ({ ...c, ...patch }));

  useLayoutEffect(() => {
    if (focus) document.getElementById(`rerun-${focus}`)?.focus();
  }, [focus]);

  const onClose = props.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={props.onClose}>
      <section className="modal rerun" role="dialog" aria-modal="true" aria-labelledby="rerun-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="rerun-title">Transcribe again</h2>
            <p className="muted">{props.title}</p>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div className="modal-body rerun-form">
          {props.missingModel && <p className="note">{props.missingModel} is not installed any more, so another model is chosen.</p>}
          <label className="field" htmlFor="rerun-model">
            <span className="label">Model</span>
            <Select
              id="rerun-model"
              className="field-select"
              value={choice.modelId}
              onChange={(value) => set({ modelId: value })}
              label="Model"
              options={installed.map((m) => ({ value: m.id, label: menuLabel(m) }))}
            />
          </label>
          <label className={`field${focus === "language" ? " focused" : ""}`} htmlFor="rerun-language">
            <span className="label">Recording language</span>
            <Select
              id="rerun-language"
              className="field-select"
              value={locked ?? choice.language}
              disabled={locked !== null}
              onChange={(value) => set({ language: value })}
              label="Recording language"
              options={locked && !languages.some((l) => l.value === locked) ? [...languages, { value: locked, label: model?.language_name ?? locked }] : languages}
            />
          </label>
          <div className={`field wide${focus === "speakers" ? " focused" : ""}`}>
            <span className="label">Speakers</span>
            {props.tracks > 1 ? (
              <span className="field-note">One per audio track, {props.tracks} tracks</span>
            ) : backend ? (
              <span className="field-row">
                <Select
                  id="rerun-speakers"
                  className="field-select grow"
                  value={choice.speakers}
                  onChange={(value) => set({ speakers: value })}
                  label="Speakers"
                  options={[
                    { value: "off", label: "Disabled" },
                    { value: "auto", label: "Auto" },
                    ...DETECTION[backend].counts.map((n) => ({ value: String(n), label: backend === "nemotron" ? `Up to ${n} people` : `${n} people` })),
                  ]}
                />
                {backend === "sherpa" && choice.speakers !== "off" && (
                  <Select
                    className="field-select"
                    value={choice.precision}
                    onChange={(value) => set({ precision: value as RerunChoice["precision"] })}
                    label="Precision of speaker detection"
                    options={[
                      { value: "standard", label: "Standard" },
                      { value: "fast", label: "Fast" },
                    ]}
                  />
                )}
              </span>
            ) : (
              <span className="field-note">
                Not named.{" "}
                <button type="button" className="inline-link" onClick={props.onSetUpDetection}>
                  Set up speaker detection
                </button>
              </span>
            )}
          </div>
          {props.edited && <p className="note">Replaces this result and its corrections in history. Files outside the app stay where they are.</p>}
        </div>
        <footer className="modal-foot">
          <span className="rerun-actions">
            <button type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => props.onRun({ ...choice, language: parseLanguage(locked ?? choice.language).code })} disabled={!model}>
              <Retry size={15} />
              Transcribe again
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}
