import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DropZone } from "./components/DropZone";
import { ErrorView } from "./components/ErrorView";
import { ModelsPanel } from "./components/ModelsPanel";
import { ResultView } from "./components/ResultView";
import { RunView } from "./components/RunView";
import { SystemBar } from "./components/SystemBar";
import { Toolbar } from "./components/Toolbar";
import { folderOf } from "./lib/format";
import { getBackend, type Backend } from "./lib/ipc";
import { idle, reduce } from "./lib/run";
import type { DownloadProgress, Language, ModelStatus, Stats } from "./lib/types";

const STORAGE = "tlansclaib.settings";

function loadSettings(): { modelId: string; language: string } {
  try {
    return { modelId: "", language: "auto", ...JSON.parse(localStorage.getItem(STORAGE) ?? "{}") };
  } catch {
    return { modelId: "", language: "auto" };
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export default function App() {
  const backend = useRef<Backend | null>(null);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState("");
  const [settings, setSettings] = useState(loadSettings);
  const [panel, setPanel] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [dragging, setDragging] = useState(false);
  const [run, dispatch] = useReducer(reduce, idle);

  const installed = useMemo(() => models.filter((m) => m.installed), [models]);
  const model = installed.find((m) => m.id === settings.modelId) ?? installed[0] ?? null;
  const locked = model && !model.languages.includes("all") ? model.languages[0] : null;
  const running = run.status === "running";

  const refreshModels = useCallback(async () => {
    const b = backend.current;
    if (b) setModels(await b.listModels());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let unlisten: (() => void)[] = [];
    getBackend().then(async (b) => {
      backend.current = b;
      setModels(await b.listModels());
      setFolder(await b.modelsFolder());
      b.listLanguages().then(setLanguages).catch(() => setLanguages([]));
      b.autorun().then((audio) => {
        if (audio) start(audio, null);
      });
      unlisten = await Promise.all([
        b.onEngineEvent((event) => dispatch({ type: "engine", event, now: Date.now() })),
        b.onStats(setStats),
        b.onDownloadProgress((p) => setDownloads((d) => ({ ...d, [p.id]: p }))),
        b.onModelsChanged(() => b.listModels().then(setModels)),
        b.onDrop((state) => {
          if (Array.isArray(state)) {
            setDragging(false);
            if (state[0]) start(state[0], null);
          } else setDragging(state === "over");
        }),
      ]);
    });
    return () => unlisten.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    async (audio: string, outputDir: string | null) => {
      const b = backend.current;
      const current = (await b?.listModels())?.filter((m) => m.installed) ?? [];
      const chosen = current.find((m) => m.id === settings.modelId) ?? current[0];
      if (!b || !chosen) {
        setPanel(true);
        return;
      }
      const language = chosen.languages.includes("all") ? settings.language : chosen.languages[0];
      dispatch({ type: "start", audio, modelName: chosen.name, now: Date.now() });
      try {
        await b.startRun(audio, chosen.id, language, outputDir);
      } catch (error) {
        dispatch({ type: "fail", message: String(error) });
      }
    },
    [settings],
  );

  const choose = async () => {
    const path = await backend.current?.pickAudioFile();
    if (path) start(path, null);
  };

  const saveElsewhere = async () => {
    const dir = await backend.current?.pickFolder();
    if (dir) start(run.audio, dir);
  };

  const download = async (id: string) => {
    setPanelError(null);
    try {
      await backend.current?.downloadModel(id);
    } catch (error) {
      setPanelError(String(error));
    } finally {
      setDownloads((d) => {
        const { [id]: _, ...rest } = d;
        return rest;
      });
      refreshModels();
    }
  };

  const addFile = async (id: string | null) => {
    const b = backend.current;
    if (!b) return;
    setPanelError(null);
    const path = await b.pickModelFile();
    if (!path) return;
    try {
      const added = await b.addModelFile(id, path);
      setSettings((s) => ({ ...s, modelId: added.id }));
    } catch (error) {
      setPanelError(String(error));
    }
    refreshModels();
  };

  const remove = async (id: string) => {
    setPanelError(null);
    try {
      await backend.current?.deleteModel(id);
    } catch (error) {
      setPanelError(String(error));
    }
    refreshModels();
  };

  const main = () => {
    switch (run.status) {
      case "running":
        return <RunView run={run} onCancel={() => backend.current?.cancelRun()} />;
      case "done":
        return (
          <ResultView
            run={run}
            onOpenFolder={(path) => backend.current?.reveal(path)}
            onCopy={async () => {
              const text = await backend.current?.readTextFile(run.result!.file).catch(() => null);
              await copyText(text ?? run.lines.map((l) => l.text).filter(Boolean).join("\n"));
            }}
            onAnother={() => dispatch({ type: "reset" })}
          />
        );
      case "error":
        return (
          <ErrorView
            title="Something went wrong"
            message={run.error ?? ""}
            onRetry={() => dispatch({ type: "reset" })}
            onSaveElsewhere={run.error?.includes("cannot write") ? saveElsewhere : null}
          />
        );
      case "cancelled":
        return (
          <ErrorView
            title="Cancelled"
            message={`The transcription was stopped. What was done so far is saved in ${folderOf(run.audio)}.`}
            onRetry={() => dispatch({ type: "reset" })}
            onSaveElsewhere={null}
          />
        );
      default:
        return <DropZone ready={installed.length > 0} dragging={dragging} onChoose={choose} onGetModel={() => setPanel(true)} />;
    }
  };

  return (
    <div className="app">
      <Toolbar
        models={models}
        modelId={model?.id ?? ""}
        onModel={(id) => setSettings((s) => ({ ...s, modelId: id }))}
        languages={languages}
        language={settings.language}
        onLanguage={(code) => setSettings((s) => ({ ...s, language: code }))}
        locked={locked}
        busy={running}
        onOpenModels={() => setPanel(true)}
      />
      <main>{main()}</main>
      <SystemBar stats={stats} running={running} />
      {panel && (
        <ModelsPanel
          models={models}
          downloads={downloads}
          stats={stats}
          busy={running}
          error={panelError}
          folder={folder}
          onDownload={download}
          onCancelDownload={(id) => backend.current?.cancelDownload(id)}
          onAddFile={addFile}
          onDelete={remove}
          onShowFolder={() => backend.current?.reveal(folder)}
          onClose={() => {
            setPanel(false);
            setPanelError(null);
          }}
        />
      )}
    </div>
  );
}
