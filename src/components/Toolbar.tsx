import type { Language, ModelStatus } from "../lib/types";
import { capitalize } from "../lib/format";

type Props = {
  models: ModelStatus[];
  modelId: string;
  onModel: (id: string) => void;
  languages: Language[];
  language: string;
  onLanguage: (code: string) => void;
  locked: string | null;
  busy: boolean;
  onOpenModels: () => void;
};

export function Toolbar({ models, modelId, onModel, languages, language, onLanguage, locked, busy, onOpenModels }: Props) {
  const installed = models.filter((m) => m.installed);
  const sorted = [...languages].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <header className="toolbar">
      <label>
        <span>Model</span>
        <select value={modelId} onChange={(e) => onModel(e.target.value)} disabled={busy || installed.length === 0}>
          {installed.length === 0 && <option value="">No model installed</option>}
          {installed.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Language</span>
        <select value={locked ?? language} onChange={(e) => onLanguage(e.target.value)} disabled={busy || locked !== null}>
          <option value="auto">Detect automatically</option>
          {sorted.map((l) => (
            <option key={l.code} value={l.code}>
              {capitalize(l.name)}
            </option>
          ))}
        </select>
      </label>
      <span className="spacer" />
      <button type="button" onClick={onOpenModels} disabled={busy}>
        Models…
      </button>
    </header>
  );
}
