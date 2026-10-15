import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { DropZone } from "./components/DropZone";
import { ErrorView } from "./components/ErrorView";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { ModelsPanel } from "./components/ModelsPanel";
import { RerunDialog, type RerunChoice } from "./components/RerunDialog";
import { ResultView } from "./components/ResultView";
import { SupportDialog } from "./components/SupportDialog";
import { RunView } from "./components/RunView";
import { SettingsBar } from "./components/SettingsBar";
import { SystemBar } from "./components/SystemBar";
import { TopBar } from "./components/TopBar";
import { capitalize, fileName, folderOf, titleOf, transcriptText } from "./lib/format";
import { getBackend, type Backend } from "./lib/ipc";
import { idle, reduce } from "./lib/run";
import { DONATE } from "./lib/about";
import { loadSettings, saveSettings } from "./lib/settings";
import { askedForSupport, countFromHistory, countOne, shouldAskForSupport } from "./lib/support";
import { parseTranscript, withTimes } from "./lib/transcript";
import { applyTheme } from "./lib/theme";
import { DETECTION_ID } from "./lib/detection";
import type { DiskSpace, DownloadProgress, FileKind, HistoryEntry, Language, ModelStatus, SpeakerDetection, Stats } from "./lib/types";

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
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState("");
  const [settings, setSettings] = useState(loadSettings);
  const [panel, setPanel] = useState<"models" | "about" | "support" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskSpace | null>(null);
  const [speed, setSpeed] = useState<number | "measuring" | "offline">("measuring");
  const [panelError, setPanelError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [detection, setDetection] = useState<SpeakerDetection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [run, dispatch] = useReducer(reduce, idle);
  const startLatest = useRef<(audio: string, outputDir: string | null) => void>(() => {});
  const stageLatest = useRef<(audio: string) => void>(() => {});
  const [pending, setPending] = useState<string | null>(null);
  const [modelsFocus, setModelsFocus] = useState<"detection" | null>(null);
  const [rerunTarget, setRerunTarget] = useState<{
    entry: HistoryEntry;
    replaces: boolean;
    focus: "speakers" | null;
    missingModel: string | null;
    initial: RerunChoice;
  } | null>(null);

  const installed = useMemo(() => models.filter((m) => m.installed), [models]);
  const model = installed.find((m) => m.id === settings.modelId) ?? installed[0] ?? null;
  const locked = model && !model.languages.includes("all") ? model.languages[0] : null;
  const running = run.status === "running";
  const languageName = useCallback(
    (code: string) => capitalize(languages.find((l) => l.code === code)?.name ?? code),
    [languages],
  );

  const refreshModels = useCallback(async () => {
    const b = backend.current;
    if (b) setModels(await b.listModels());
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const onPointer = () => {
      root.dataset.input = "pointer";
    };
    const onKey = (e: KeyboardEvent) => {
      root.dataset.input = "keyboard";
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        setHistoryOpen(false);
        setPanel("support");
        return;
      }
      if (e.key !== "Escape") return;
      setPanel(null);
      setPanelError(null);
      setHistoryOpen(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const measured = useRef(false);
  useEffect(() => {
    const b = backend.current;
    if (panel !== "models" || !b || measured.current) return;
    measured.current = true;
    setSpeed("measuring");
    b.measureSpeed()
      .then(setSpeed)
      .catch(() => {
        measured.current = false;
        setSpeed("offline");
      });
  }, [panel]);

  useEffect(() => {
    if (panel === "models") backend.current?.diskSpace().then(setDisk).catch(() => setDisk(null));
  }, [panel, models]);

  const openUrl = (url: string) => {
    backend.current?.openUrl(url).catch(() => {});
  };
  const version = useCallback(() => backend.current?.appVersion() ?? Promise.resolve(""), []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void)[] = [];
    getBackend().then(async (b) => {
      if (!active) return;
      backend.current = b;
      setModels(await b.listModels());
      setFolder(await b.modelsFolder());
      b.speakerDetection().then(setDetection).catch(() => setDetection(null));
      b.listLanguages().then(setLanguages).catch(() => setLanguages([]));
      b.listHistory()
        .then((entries) => {
          setHistory(entries);
          setSettings((s) => countFromHistory(s, entries));
        })
        .catch(() => setHistory([]));
      b.autorun().then((audio) => {
        if (audio) startLatest.current(audio, null);
      });
      const registered = await Promise.all([
        b.onEngineEvent((event) => dispatch({ type: "engine", event, now: Date.now() })),
        b.onStats(setStats),
        b.onDownloadProgress((p) => setDownloads((d) => ({ ...d, [p.id]: p }))),
        b.onModelsChanged(() => {
          b.listModels().then(setModels);
          b.speakerDetection().then(setDetection).catch(() => setDetection(null));
        }),
        b.onHistoryChanged(() => b.listHistory().then(setHistory)),
        b.onDrop((state) => {
          if (Array.isArray(state)) {
            setDragging(false);
            if (state[0]) stageLatest.current(state[0]);
          } else setDragging(state === "over");
        }),
      ]);
      if (active) unlisten = registered;
      else registered.forEach((u) => u());
    });
    return () => {
      active = false;
      unlisten.forEach((u) => u());
    };
  }, []);

  const start = useCallback(
    async (audio: string, outputDir: string | null) => {
      const b = backend.current;
      const current = (await b?.listModels())?.filter((m) => m.installed) ?? [];
      const chosen = current.find((m) => m.id === settings.modelId) ?? current[0];
      if (!b || !chosen) {
        setPanel("models");
        return;
      }
      const multilingual = chosen.languages.includes("all");
      const language = multilingual ? settings.language : chosen.languages[0];
      const dir = outputDir ?? settings.outputDir;
      const speakers = settings.speakers !== "off" && detection?.installed ? settings.speakers : null;
      setResultError(null);
      dispatch({
        type: "start",
        audio,
        folder: dir ?? folderOf(audio),
        modelName: chosen.name,
        timestamps: settings.timestamps,
        autoLanguage: language === "auto",
        detecting: speakers !== null,
        now: Date.now(),
      });
      try {
        await b.startRun(audio, chosen.id, language, settings.timestamps, dir, speakers, speakers ? settings.speakerPrecision : null);
      } catch (error) {
        dispatch({ type: "fail", message: String(error) });
      }
    },
    [settings, detection],
  );
  startLatest.current = start;

  const stage = (audio: string) => {
    if (running) return;
    dispatch({ type: "reset" });
    setResultError(null);
    setPending(audio);
  };
  stageLatest.current = stage;

  const go = () => {
    if (!pending) return;
    const audio = pending;
    setPending(null);
    void start(audio, null);
  };

  const setUpDetection = () => {
    setModelsFocus("detection");
    setPanel("models");
  };

  const rewrite = async (on: boolean): Promise<boolean> => {
    const b = backend.current;
    if (!b || run.status !== "done" || !run.result || run.timestamps === on || !run.timed) return true;
    try {
      const hash = await b.setTranscriptTimestamps(run.result.file, run.lines, on, run.speakers);
      dispatch({ type: "timestamps", on });
      dispatch({ type: "hash", hash });
      setResultError(null);
      return true;
    } catch (error) {
      setResultError(String(error));
      return false;
    }
  };

  const toggleTimestamps = async (on: boolean) => {
    setSettings((s) => ({ ...s, timestamps: on }));
    if (!(await rewrite(on))) setSettings((s) => ({ ...s, timestamps: !on }));
  };

  useEffect(() => {
    if (run.status !== "done" || run.opened || run.timestamps === settings.timestamps) return;
    const wanted = settings.timestamps;
    rewrite(wanted).then((ok) => {
      if (!ok) setSettings((s) => ({ ...s, timestamps: !wanted }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status]);

  useEffect(() => {
    if (run.status === "done" && !run.opened) setSettings(countOne);
  }, [run.status, run.opened]);

  useEffect(() => {
    if (run.status !== "done" || run.opened || !run.result) return;
    backend.current
      ?.transcriptHash(run.result.file)
      .then((hash) => dispatch({ type: "hash", hash }))
      .catch(() => {});
  }, [run.status, run.opened, run.result]);

  const saveLine = async (index: number, text: string): Promise<boolean> => {
    const b = backend.current;
    if (!b || !run.result) return false;
    try {
      const expected = run.hash ?? (await b.transcriptHash(run.result.file));
      const lines = run.lines.map((l, i) => (i === index ? { ...l, text } : l));
      const hash = await b.saveTranscript(run.result.file, expected, lines, run.timestamps, run.speakers);
      dispatch({ type: "edit", index, text, hash });
      setResultError(null);
      return true;
    } catch (error) {
      setResultError(String(error));
      return false;
    }
  };

  const openRerun = (entry: HistoryEntry, replaces: boolean, options: { focus?: "speakers"; speakers?: string } = {}) => {
    if (running) return;
    const usable = models.filter((m) => m.installed);
    const original = usable.find((m) => m.id === entry.model_id) ?? usable.find((m) => m.name === entry.model);
    const precision = entry.speaker_precision === "fast" || entry.speaker_precision === "standard" ? entry.speaker_precision : settings.speakerPrecision;
    setRerunTarget({
      entry,
      replaces,
      focus: options.focus ?? null,
      missingModel: original ? null : entry.model,
      initial: {
        modelId: original?.id ?? usable[0]?.id ?? "",
        language: entry.language ?? "auto",
        speakers: options.speakers ?? entry.speaker_mode ?? (entry.detected ? "auto" : "off"),
        precision,
        timestamps: entry.timestamps,
      },
    });
  };

  const startAgain = async (entry: HistoryEntry, choice: RerunChoice) => {
    const b = backend.current;
    setRerunTarget(null);
    if (!b || running) return;
    const model = models.find((m) => m.installed && m.id === choice.modelId);
    if (!model) return;
    const speakers = choice.speakers !== "off" && detection?.installed ? choice.speakers : null;
    setResultError(null);
    setHistoryError(null);
    setHistoryOpen(false);
    dispatch({
      type: "start",
      audio: entry.audio,
      folder: folderOf(entry.file),
      modelName: model.name,
      timestamps: choice.timestamps,
      autoLanguage: choice.language === "auto",
      detecting: speakers !== null,
      now: Date.now(),
    });
    try {
      await b.startRun(entry.audio, model.id, choice.language, choice.timestamps, null, speakers, speakers ? choice.precision : null, entry.file);
    } catch (error) {
      dispatch({ type: "fail", message: String(error) });
    }
  };

  const rerunResult = (options: { focus?: "speakers"; speakers?: string } = {}) => {
    const file = run.result?.file;
    const entry = history.find((h) => h.file === file) ?? run.opened;
    if (entry) openRerun(entry, true, options);
    else setResultError("This transcript is not in the history, so its settings are unknown.");
  };

  const renameSpeaker = async (track: number, name: string): Promise<boolean> => {
    const b = backend.current;
    if (!b || !run.result) return false;
    const speakers = run.speakers.map((s, i) => (i === track ? name : s));
    try {
      const expected = run.hash ?? (await b.transcriptHash(run.result.file));
      const hash = await b.saveTranscript(run.result.file, expected, run.lines, run.timestamps, speakers);
      dispatch({ type: "speakers", speakers, hash });
      setResultError(null);
      return true;
    } catch (error) {
      setResultError(String(error));
      return false;
    }
  };

  useEffect(() => {
    if (run.status !== "done" || run.opened || panel !== null || !shouldAskForSupport(settings)) return;
    const t = setTimeout(() => {
      setSettings(askedForSupport);
      setPanel("support");
    }, 1200);
    return () => clearTimeout(t);
  }, [run.status, panel, settings]);

  const support = () => {
    setSettings((s) => ({ ...s, supported: true }));
    openUrl(DONATE);
  };

  const choose = async () => {
    const path = await backend.current?.pickAudioFile();
    if (path) stage(path);
  };

  const renameTranscript = async (title: string): Promise<boolean> => {
    const b = backend.current;
    if (!b || !run.result) return false;
    try {
      const file = await b.renameTranscript(run.result.file, title);
      dispatch({ type: "rename", file });
      setResultError(null);
      return true;
    } catch (error) {
      setResultError(String(error));
      return false;
    }
  };

  const chooseOutputDir = async () => {
    const dir = await backend.current?.pickFolder();
    if (dir) setSettings((s) => ({ ...s, outputDir: dir }));
  };

  const saveElsewhere = async () => {
    const dir = await backend.current?.pickFolder();
    if (!dir) return;
    setSettings((s) => ({ ...s, outputDir: dir }));
    start(run.audio, dir);
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

  const downloadDetection = async () => {
    setPanelError(null);
    try {
      await backend.current?.downloadSpeakerDetection();
      setSettings((s) => (s.speakers === "off" ? { ...s, speakers: "auto" } : s));
    } catch (error) {
      setPanelError(String(error));
    } finally {
      setDownloads((d) => {
        const { [DETECTION_ID]: _, ...rest } = d;
        return rest;
      });
      backend.current?.speakerDetection().then(setDetection).catch(() => {});
    }
  };

  const removeDetection = async () => {
    setPanelError(null);
    try {
      await backend.current?.removeSpeakerDetection();
      setSettings((s) => ({ ...s, speakers: "off" }));
    } catch (error) {
      setPanelError(String(error));
    }
    backend.current?.speakerDetection().then(setDetection).catch(() => {});
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

  const unlink = async (id: string) => {
    setPanelError(null);
    try {
      await backend.current?.unlinkModel(id);
    } catch (error) {
      setPanelError(String(error));
    }
    refreshModels();
  };

  const renameModel = async (id: string, name: string) => {
    setPanelError(null);
    try {
      await backend.current?.renameModel(id, name);
    } catch (error) {
      setPanelError(String(error));
    }
    refreshModels();
  };

  const closePanel = () => {
    setPanel(null);
    setModelsFocus(null);
    setPanelError(null);
  };

  const openHistory = async (entry: HistoryEntry) => {
    const b = backend.current;
    if (!b || running) return;
    setHistoryError(null);
    try {
      const opened = await b.openHistory(entry.id);
      const parsed = withTimes(parseTranscript(opened.text, entry.speakers ?? []), opened.times);
      setResultError(null);
      dispatch({
        type: "open",
        entry,
        lines: parsed.lines,
        timestamps: parsed.timestamps,
        timed: parsed.timed,
        check: { changed: opened.changed, audio: opened.audio },
        hash: opened.hash,
      });
      setHistoryOpen(false);
    } catch (error) {
      setHistoryError(`Cannot open ${entry.file}: ${String(error)}`);
      b.listHistory().then(setHistory).catch(() => {});
    }
  };

  const relocate = async (entry: HistoryEntry, kind: FileKind): Promise<string | null> => {
    const b = backend.current;
    if (!b) return null;
    const path = kind === "audio" ? await b.pickAudioFile() : await b.pickTranscriptFile();
    if (!path) return null;
    if ((await b.checkCandidate(entry.id, kind, path)) === "different") {
      const question =
        kind === "audio"
          ? "This recording is not the one that was transcribed: its content is different. Use it anyway?"
          : "This file is not the transcript tlansclaib saved: its content is different. It may have been edited, or it is another transcript. Use it anyway?";
      if (!(await b.confirm(question, "Use it anyway"))) return null;
    }
    await b.relocateHistory(entry.id, kind, path);
    return path;
  };

  const locateTranscript = async (entry: HistoryEntry) => {
    setHistoryError(null);
    try {
      await relocate(entry, "transcript");
    } catch (error) {
      setHistoryError(String(error));
    }
  };

  const locateAudio = async () => {
    if (!run.opened) return;
    try {
      const path = await relocate(run.opened, "audio");
      if (path) dispatch({ type: "audio", path });
    } catch (error) {
      setResultError(String(error));
    }
  };

  const main = () => {
    switch (run.status) {
      case "running":
        return (
          <RunView
            run={run}
            showTimes={settings.timestamps}
            languageName={languageName}
            onCancel={() => backend.current?.cancelRun()}
          />
        );
      case "done":
        return (
          <ResultView
            run={run}
            error={resultError}
            noTimecodes={!run.timed}
            timecodes={run.timestamps}
            onTimecodes={toggleTimestamps}
            languageName={languageName}
            audioUrl={(path) => backend.current?.audioUrl(path) ?? Promise.reject(new Error("not ready"))}
            onLocateAudio={locateAudio}
            onSaveLine={saveLine}
            onLog={(level, message) => backend.current?.log(level, message)}
            onOpenFolder={(path) => backend.current?.reveal(path)}
            onCopy={async () => {
              const text = await backend.current?.readTextFile(run.result!.file).catch(() => null);
              await copyText(text ?? transcriptText(run.lines, run.timestamps, run.speakers));
            }}
            onRename={renameTranscript}
            onRenameSpeaker={renameSpeaker}
            onRerun={rerunResult}
            detectionInstalled={detection?.installed ?? false}
            onSetUpDetection={setUpDetection}
            onClose={() => dispatch({ type: "reset" })}
            onAnother={() => dispatch({ type: "reset" })}
          />
        );
      case "error":
        return (
          <ErrorView
            title="Something went wrong"
            message={run.error ?? ""}
            onRetry={() => dispatch({ type: "reset" })}
            onSaveElsewhere={run.error?.includes("cannot write") || run.error?.includes("Save to") ? saveElsewhere : null}
          />
        );
      case "cancelled":
        return (
          <ErrorView
            title="Cancelled"
            message={`The transcription was stopped. What was done so far is saved in ${run.folder}.`}
            onRetry={() => dispatch({ type: "reset" })}
            onSaveElsewhere={null}
          />
        );
      default:
        return (
          <DropZone
            ready={installed.length > 0}
            dragging={dragging}
            pending={pending}
            summary={[
              model?.name ?? "",
              locked ? languageName(locked) : settings.language === "auto" ? "Language detected" : languageName(settings.language),
              !detection?.installed || settings.speakers === "off"
                ? "Speakers not named"
                : `${settings.speakers === "auto" ? "Speakers detected" : `${settings.speakers} people`}${settings.speakerPrecision === "fast" ? ", fast" : ""}`,
              settings.outputDir ? `Saved in ${fileName(settings.outputDir)}` : "Saved next to the recording",
            ]}
            onGo={go}
            onClear={() => setPending(null)}
            onChoose={choose}
            onGetModel={() => setPanel("models")}
          />
        );
    }
  };

  return (
    <div className="app">
      <TopBar
        theme={settings.theme}
        onTheme={(theme) => setSettings((s) => ({ ...s, theme }))}
        historyOpen={historyOpen}
        onHistory={() => setHistoryOpen((o) => !o)}
        onModels={() => setPanel("models")}
        onAbout={() => setPanel("about")}
        busy={running}
      />
      <main>
        {run.status !== "running" && run.status !== "done" && (
        <SettingsBar
          models={models}
          modelId={model?.id ?? ""}
          onModel={(id) => setSettings((s) => ({ ...s, modelId: id }))}
          languages={languages}
          language={settings.language}
          onLanguage={(code) => setSettings((s) => ({ ...s, language: code }))}
          locked={locked}
          outputDir={settings.outputDir}
          onOutputDir={(dir) => setSettings((s) => ({ ...s, outputDir: dir }))}
          onChooseOutputDir={chooseOutputDir}
          speakers={settings.speakers}
          detection={detection?.installed ?? false}
          onSpeakers={(value) => setSettings((s) => ({ ...s, speakers: value }))}
          speakerPrecision={settings.speakerPrecision}
          onSpeakerPrecision={(value) => setSettings((s) => ({ ...s, speakerPrecision: value }))}
          onSetUpSpeakers={setUpDetection}
          stats={stats}
          busy={running}
        />
        )}
        <div className="stage">{main()}</div>
      </main>
      <SystemBar stats={stats} running={running} onCredit={() => setPanel("support")} />
      {panel === "models" && (
        <ModelsPanel
          focus={modelsFocus}
          models={models}
          downloads={downloads}
          stats={stats}
          disk={disk}
          speed={speed}
          busy={running}
          error={panelError}
          folder={folder}
          onDownload={download}
          onCancelDownload={(id) => backend.current?.cancelDownload(id)}
          onAddFile={addFile}
          onDelete={remove}
          onUnlink={unlink}
          onRename={renameModel}
          onShowFolder={() => backend.current?.reveal(folder)}
          onOpenUrl={openUrl}
          detection={detection}
          onDownloadDetection={downloadDetection}
          onCancelDetection={() => backend.current?.cancelSpeakerDetection()}
          onRemoveDetection={removeDetection}
          onClose={closePanel}
        />
      )}
      {rerunTarget && (
        <RerunDialog
          title={titleOf(rerunTarget.entry.file)}
          replaces={rerunTarget.replaces}
          tracks={!rerunTarget.entry.detected ? (rerunTarget.entry.speakers?.length ?? 0) : 0}
          models={models}
          languages={languages}
          detection={detection?.installed ?? false}
          initial={rerunTarget.initial}
          focus={rerunTarget.focus}
          missingModel={rerunTarget.missingModel}
          onSetUpDetection={() => {
            setRerunTarget(null);
            setUpDetection();
          }}
          onRun={(choice) => void startAgain(rerunTarget.entry, choice)}
          onClose={() => setRerunTarget(null)}
        />
      )}
      {panel === "about" && <AboutDialog version={version} onOpenUrl={openUrl} onSupport={support} onClose={closePanel} />}
      {panel === "support" && (
        <SupportDialog
          onSupport={() => {
            support();
            closePanel();
          }}
          onClose={closePanel}
        />
      )}
      <HistoryDrawer
        open={historyOpen}
        entries={history}
        languageName={languageName}
        busy={running}
        error={historyError}
        onOpen={openHistory}
        onLocate={locateTranscript}
        onRerun={(entry) => openRerun(entry, false)}
        onReveal={(path) => backend.current?.reveal(path)}
        onRemove={(id) => backend.current?.removeHistory(id)}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryError(null);
        }}
      />
    </div>
  );
}
