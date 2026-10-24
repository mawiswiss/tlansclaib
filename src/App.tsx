import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AboutDialog } from "./components/AboutDialog";
import { DropZone } from "./components/DropZone";
import { ErrorView } from "./components/ErrorView";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { ModelDetails, ModelsDialog } from "./components/ModelsPanel";
import { RerunDialog, type RerunChoice } from "./components/RerunDialog";
import { ResultView } from "./components/ResultView";
import { SupportDialog } from "./components/SupportDialog";
import { RunView } from "./components/RunView";
import { SettingsBar } from "./components/SettingsBar";
import { SetupProgress } from "./components/SetupProgress";
import { SetupView } from "./components/SetupView";
import { SystemBar } from "./components/SystemBar";
import { TopBar } from "./components/TopBar";
import { capitalize, titleOf, transcriptText } from "./lib/format";
import { getBackend, type Backend } from "./lib/ipc";
import { idle, reduce } from "./lib/run";
import { DONATE } from "./lib/about";
import { loadSettings, saveSettings, settingsLoadError } from "./lib/settings";
import { askedForSupport, countFromHistory, countOne, shouldAskForSupport } from "./lib/support";
import { parseTranscript, withTimes } from "./lib/transcript";
import { applyTheme } from "./lib/theme";
import { checkDue, topBarLabel, type UpdateState } from "./lib/update";
import { DETECTION_IDS, downloadOrder, installed as isInstalled, languageKey, leftovers, MODE_NAMES, missing, modelFor, parseLanguage, runLanguages, sizeOf, wanted, wantedBackend, type Setup } from "./lib/setup";
import type { DiskSpace, DownloadProgress, FileKind, Gpu, HistoryEntry, Language, ModelStatus, SpeakerBackend, SpeakerDetection, Stats } from "./lib/types";

function backendOf(id: string): SpeakerBackend | undefined {
  return (Object.keys(DETECTION_IDS) as SpeakerBackend[]).find((b) => DETECTION_IDS[b] === id);
}

type RerunOptions = { focus?: "speakers" | "language"; speakers?: string; language?: string };

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    try {
      area.select();
      if (!document.execCommand("copy")) throw new Error("Clipboard access was denied.");
    } finally {
      area.remove();
    }
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
  const settingsAtStart = useRef(settings);
  const [appErrors, setAppErrors] = useState<string[]>(settingsLoadError ? [settingsLoadError] : []);
  const [panel, setPanel] = useState<"models" | "about" | "support" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskSpace | null>(null);
  const [speed, setSpeed] = useState<number | "measuring" | "offline">("measuring");
  const [panelError, setPanelError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [detections, setDetections] = useState<SpeakerDetection[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [gpu, setGpu] = useState<Gpu | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ sizes: Record<string, number>; total: number } | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [run, dispatch] = useReducer(reduce, idle);
  const startLatest = useRef<(audio: string) => void>(() => {});
  const stageLatest = useRef<(audio: string) => void>(() => {});
  const [pending, setPending] = useState<string | null>(null);
  const [modelsFocus, setModelsFocus] = useState<"detection" | null>(null);
  const [aboutFocus, setAboutFocus] = useState<"update" | null>(null);
  const [rerunTarget, setRerunTarget] = useState<{
    entry: HistoryEntry;
    focus: "speakers" | "language" | null;
    missingModel: string | null;
    initial: RerunChoice;
  } | null>(null);

  const installed = useMemo(() => models.filter((m) => m.installed), [models]);
  const setup = settings.setup;
  const runLanguage = parseLanguage(settings.language);
  const model = modelFor(models, setup, runLanguage, settings.modelId);
  const pinned = installed.some((m) => m.id === settings.modelId);
  const locked = pinned && model && !model.languages.includes("all") ? languageKey({ code: model.languages[0], variant: model.language_name ?? null }) : null;
  const speakerBackend = wantedBackend(setup, detections);
  const firstRun = modelsLoaded && !setup && installed.length === 0;
  const languageOptions = useMemo(() => runLanguages(models, languages), [models, languages]);
  const running = run.status === "running";
  const updateWait = running
    ? "Updating waits until the transcription has finished."
    : Object.keys(downloads).length > 0 || detections.some((d) => d.downloading)
      ? "Updating waits until the download has finished."
      : null;
  const updateWaitLatest = useRef(updateWait);
  updateWaitLatest.current = updateWait;
  const languageName = useCallback(
    (code: string) => capitalize(languages.find((l) => l.code === code)?.name ?? code),
    [languages],
  );
  const languageLabel = (key: string) => parseLanguage(key).variant ?? languageName(parseLanguage(key).code);
  const showError = useCallback((message: string) => {
    setAppErrors((current) => current.includes(message) ? current : [...current, message].slice(-10));
  }, []);
  const reportError = useCallback((context: string, error: unknown) => {
    showError(`${context}: ${String(error)}`);
  }, [showError]);
  const requireBackend = useCallback(() => {
    if (!backend.current) throw new Error("The app is still starting. Please try again.");
    return backend.current;
  }, []);

  const refreshModels = useCallback(async () => {
    const b = backend.current;
    if (!b) return;
    try {
      setModels(await b.listModels());
    } catch (error) {
      reportError("Could not refresh models", error);
    }
  }, [reportError]);

  useEffect(() => {
    try {
      saveSettings(settings);
    } catch (error) {
      reportError("Could not save settings", error);
    }
  }, [settings, reportError]);

  useEffect(() => {
    void applyTheme(settings.theme).catch((error) => reportError("Could not apply the appearance", error));
  }, [settings.theme, reportError]);

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
  const [measureAgain, setMeasureAgain] = useState(0);
  const looking = panel === "models" || firstRun;
  useEffect(() => {
    const b = backend.current;
    if (!looking || !b || measured.current) return;
    measured.current = true;
    setSpeed("measuring");
    b.measureSpeed()
      .then(setSpeed)
      .catch(() => {
        measured.current = false;
        setSpeed("offline");
      });
    const precise = models.find((m) => (m.setups ?? []).includes("precise") && m.languages.includes("all"));
    b.gpuInfo(precise?.id ?? null)
      .then(setGpu)
      .catch((error) => reportError("Could not check the graphics chip", error));
  }, [looking, measureAgain, models, reportError]);

  useEffect(() => {
    if (looking) backend.current?.diskSpace().then(setDisk).catch((error) => reportError("Could not check disk space", error));
  }, [looking, models, reportError]);

  const openUrl = (url: string) => {
    void Promise.resolve().then(() => requireBackend().openUrl(url)).catch((error) => reportError("Could not open the link", error));
  };
  const version = useCallback(() => backend.current?.appVersion() ?? Promise.reject(new Error("The app is still starting.")), []);

  const checkUpdate = useCallback(async (quiet: boolean) => {
    const b = backend.current;
    if (!b) return;
    if (!quiet) setUpdate({ status: "checking" });
    try {
      const found = await b.checkUpdate();
      setSettings((s) => ({ ...s, updateCheckedAt: Date.now() }));
      if (found) setUpdate({ status: "available", version: found });
      else if (!quiet) setUpdate({ status: "current" });
    } catch (error) {
      if (quiet) b.log("warn", `Could not check for updates: ${String(error)}`);
      else setUpdate({ status: "failed", version: null, message: String(error) });
    }
  }, []);

  const installUpdate = async (version: string) => {
    setUpdate({ status: "installing", version });
    try {
      await requireBackend().installUpdate();
    } catch (error) {
      setUpdate({ status: "failed", version, message: `Installing failed: ${String(error)}` });
    }
  };

  const startUpdate = async (version: string) => {
    try {
      const b = requireBackend();
      const blocker = await b.updateBlocker();
      if (blocker) {
        setUpdate({ status: "failed", version, message: blocker });
        return;
      }
      setUpdate({ status: "downloading", version, received: 0, total: null });
      await b.downloadUpdate((received, total) => setUpdate({ status: "downloading", version, received, total }));
    } catch (error) {
      setUpdate({ status: "failed", version, message: `The download failed: ${String(error)}` });
      return;
    }
    if (updateWaitLatest.current) setUpdate({ status: "ready", version });
    else await installUpdate(version);
  };

  useEffect(() => {
    let active = true;
    const unlisten: (() => void)[] = [];
    void getBackend().then(async (b) => {
      if (!active) return;
      backend.current = b;
      const listeners = [
        ["transcription events", b.onEngineEvent((event) => {
          if (event.event === "warning") showError(event.message);
          dispatch({ type: "engine", event, now: Date.now() });
        })],
        ["system status", b.onStats(setStats)],
        ["download progress", b.onDownloadProgress((p) => setDownloads((d) => ({ ...d, [p.id]: p })))],
        ["app errors", b.onAppError(showError)],
        ["model changes", b.onModelsChanged(() => {
          void refreshModels();
          void b.speakerDetection().then(setDetections).catch((error) => reportError("Could not refresh speaker detection", error));
        })],
        ["history changes", b.onHistoryChanged(() => {
          void b.listHistory().then(setHistory).catch((error) => reportError("Could not refresh history", error));
        })],
        ["file drops", b.onDrop((state) => {
          if (Array.isArray(state)) {
            setDragging(false);
            if (state[0]) stageLatest.current(state[0]);
          } else setDragging(state === "over");
        })],
      ] as const;
      const registered = await Promise.allSettled(listeners.map(([, promise]) => promise));
      registered.forEach((result, index) => {
        if (result.status === "fulfilled") {
          if (active) unlisten.push(result.value);
          else result.value();
        } else if (active) reportError(`Could not listen for ${listeners[index][0]}`, result.reason);
      });
      if (!active) return;
      void b.listModels().then((list) => {
        setModels(list);
        setModelsLoaded(true);
      }).catch((error) => reportError("Could not load models", error));
      void b.modelsFolder().then(setFolder).catch((error) => reportError("Could not find the models folder", error));
      void b.speakerDetection().then(setDetections).catch((error) => reportError("Could not load speaker detection", error));
      void b.listLanguages().then(setLanguages).catch((error) => reportError("Could not load languages", error));
      void b.listHistory().then((entries) => {
        setHistory(entries);
        setSettings((s) => countFromHistory(s, entries));
      }).catch((error) => reportError("Could not load history", error));
      const saved = settingsAtStart.current;
      if (checkDue(saved.checkUpdates, saved.updateCheckedAt, Date.now())) void checkUpdate(true);
      void b.autorun().then((audio) => {
        if (active && audio) startLatest.current(audio);
      }).catch((error) => reportError("Could not start the requested recording", error));
    }).catch((error) => {
      if (active) reportError("Could not start the app", error);
    });
    return () => {
      active = false;
      unlisten.forEach((u) => u());
    };
  }, [refreshModels, reportError, showError, checkUpdate]);

  const start = useCallback(
    async (audio: string) => {
      const b = backend.current;
      if (!b) {
        showError("The app is still starting. Please try again.");
        return;
      }
      let current: ModelStatus[];
      try {
        current = await b.listModels();
      } catch (error) {
        reportError("Could not check installed models", error);
        return;
      }
      const chosen = modelFor(current, settings.setup, parseLanguage(settings.language), settings.modelId);
      if (!chosen) {
        setPanel("models");
        return;
      }
      const multilingual = chosen.languages.includes("all");
      const language = multilingual ? parseLanguage(settings.language).code : chosen.languages[0];
      const speakers = settings.speakers !== "off" && speakerBackend ? settings.speakers : null;
      setResultError(null);
      dispatch({
        type: "start",
        audio,
        folder: "app history",
        modelName: chosen.name,
        timestamps: settings.timestamps,
        autoLanguage: language === "auto",
        detecting: speakers !== null,
        now: Date.now(),
      });
      try {
        await b.startRun(audio, chosen.id, language, settings.timestamps, speakers, speakers && speakerBackend === "sherpa" ? settings.speakerPrecision : null, speakers ? speakerBackend : null);
      } catch (error) {
        dispatch({ type: "fail", message: String(error) });
      }
    },
    [settings, speakerBackend, reportError, showError],
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
    void start(audio);
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
      .catch((error) => setResultError(`Could not check the saved transcript: ${String(error)}`));
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

  const openRerun = (entry: HistoryEntry, options: RerunOptions = {}) => {
    if (running) return;
    const usable = models.filter((m) => m.installed);
    const original = usable.find((m) => m.id === entry.model_id) ?? usable.find((m) => m.name === entry.model);
    const precision = entry.speaker_precision === "fast" || entry.speaker_precision === "standard" ? entry.speaker_precision : settings.speakerPrecision;
    const previous = entry.speaker_backend ?? (entry.speaker_mode ? "sherpa" : null);
    const rerunBackend = previous && detections.some((d) => d.backend === previous && d.installed) ? previous : speakerBackend;
    setRerunTarget({
      entry,
      focus: options.focus ?? null,
      missingModel: original ? null : entry.model,
      initial: {
        modelId: original?.id ?? usable[0]?.id ?? "",
        language: options.language ?? entry.language ?? "auto",
        speakers: options.speakers ?? entry.speaker_mode ?? (entry.detected ? "auto" : "off"),
        precision,
        backend: rerunBackend,
        timestamps: entry.timestamps,
      },
    });
  };

  const startAgain = async (entry: HistoryEntry, choice: RerunChoice) => {
    const b = backend.current;
    setRerunTarget(null);
    if (!b || running) {
      if (!b) showError("The app is still starting. Please try again.");
      return;
    }
    const model = models.find((m) => m.installed && m.id === choice.modelId);
    if (!model) {
      showError("The selected model is no longer installed. Choose another model.");
      return;
    }
    const speakers = choice.speakers !== "off" && choice.backend ? choice.speakers : null;
    setResultError(null);
    setHistoryError(null);
    setHistoryOpen(false);
    dispatch({
      type: "start",
      audio: entry.audio,
      folder: "app history",
      modelName: model.name,
      timestamps: choice.timestamps,
      autoLanguage: choice.language === "auto",
      detecting: speakers !== null,
      now: Date.now(),
    });
    try {
      await b.startRun(entry.audio, model.id, choice.language, choice.timestamps, speakers, speakers && choice.backend === "sherpa" ? choice.precision : null, speakers ? choice.backend : null, entry.file);
    } catch (error) {
      dispatch({ type: "fail", message: String(error) });
    }
  };

  const rerunResult = (options: RerunOptions = {}) => {
    const file = run.result?.file;
    const entry = history.find((h) => h.file === file) ?? run.opened;
    if (entry) openRerun(entry, options);
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
    if (import.meta.env.DEV) return;
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
    try {
      const path = await requireBackend().pickAudioFile();
      if (path) stage(path);
    } catch (error) {
      reportError("Could not choose a recording", error);
    }
  };

  const renameTranscript = async (title: string): Promise<boolean> => {
    const b = backend.current;
    if (!b || !run.result) return false;
    try {
      const file = await b.renameTranscript(run.result.file, title);
      dispatch({ type: "rename", file, title: title.trim().replace(/^[. ]+|[. ]+$/g, "") });
      dispatch({ type: "hash", hash: await b.transcriptHash(file) });
      setResultError(null);
      return true;
    } catch (error) {
      setResultError(String(error));
      return false;
    }
  };

  const refreshDetections = useCallback(() => {
    void backend.current?.speakerDetection().then(setDetections).catch((error) => reportError("Could not refresh speaker detection", error));
  }, [reportError]);

  const fetchItem = useCallback(async (id: string) => {
    const b = requireBackend();
    const detection = backendOf(id);
    try {
      if (detection) {
        await b.downloadSpeakerDetection(detection);
        setSettings((s) => (s.speakers === "off" ? { ...s, speakers: "auto" } : s));
      } else {
        await b.downloadModel(id);
      }
    } finally {
      setDownloads((d) => {
        const { [id]: _, ...rest } = d;
        return rest;
      });
      void refreshModels();
      refreshDetections();
    }
  }, [requireBackend, refreshModels, refreshDetections]);

  const cancelItem = async (id: string) => {
    const detection = backendOf(id);
    if (detection) await requireBackend().cancelSpeakerDetection(detection);
    else await requireBackend().cancelDownload(id);
  };

  const deleteItem = async (id: string) => {
    const detection = backendOf(id);
    if (detection) {
      await requireBackend().removeSpeakerDetection(detection);
      if (!detections.some((d) => d.installed && d.backend !== detection)) setSettings((s) => ({ ...s, speakers: "off" }));
    } else {
      await requireBackend().deleteModel(id);
    }
  };

  const include = (id: string) =>
    setSettings((s) => (s.setup ? { ...s, setup: { ...s.setup, added: s.setup.added.includes(id) ? s.setup.added : [...s.setup.added, id], removed: s.setup.removed.filter((r) => r !== id) } } : s));

  const exclude = (id: string) =>
    setSettings((s) => (s.setup ? { ...s, setup: { ...s.setup, added: s.setup.added.filter((a) => a !== id), removed: s.setup.removed.includes(id) ? s.setup.removed : [...s.setup.removed, id] } } : s));

  const queue = useRef({ busy: false, checked: "" });
  const setupKey = setup ? JSON.stringify(setup) : "";
  useEffect(() => {
    const b = backend.current;
    if (!b || !setup || !modelsLoaded || queue.current.busy) return;
    const pending = missing(downloadOrder(models, setup), models, detections).filter((id) => !failed[id]);
    if (pending.length === 0) {
      setBatch(null);
      return;
    }
    queue.current.busy = true;
    const key = setupKey;
    void (async () => {
      const first = queue.current.checked !== key;
      try {
        if (first) {
          const modelIds = pending.filter((id) => !backendOf(id));
          await b.checkSetupDownloads(modelIds, pending.map(backendOf).find(Boolean) ?? null);
          queue.current.checked = key;
          setSetupError(null);
          const sizes = Object.fromEntries(pending.map((id) => [id, sizeOf(id, models, detections)]));
          setBatch({ sizes, total: Object.values(sizes).reduce((sum, size) => sum + size, 0) });
        }
        await fetchItem(pending[0]);
      } catch (error) {
        const message = String(error);
        if (first) {
          setSetupError(message);
          setFailed((f) => ({ ...f, ...Object.fromEntries(pending.map((id) => [id, message])) }));
        } else {
          setFailed((f) => ({ ...f, [pending[0]]: message }));
        }
      } finally {
        queue.current.busy = false;
        void refreshModels();
        refreshDetections();
      }
    })();
  }, [setup, setupKey, models, detections, failed, modelsLoaded, fetchItem, refreshModels, refreshDetections]);

  const applySetup = (next: Setup) => {
    const ids = wanted(models, next);
    for (const id of Object.keys(downloads)) {
      if (!ids.includes(id)) void cancelItem(id).catch((error) => reportError("Could not cancel a download", error));
    }
    setFailed({});
    setSetupError(null);
    setPanelError(null);
    setSettings((s) => ({ ...s, setup: next, modelId: "auto", language: languageKey(next.language) }));
    setPanel(null);
    setModelsFocus(null);
  };

  const pendingIds = setup ? missing(wanted(models, setup), models, detections) : [];
  const failure = setupError ?? pendingIds.map((id) => failed[id]).find(Boolean) ?? null;
  const percent = batch && batch.total > 0
    ? Math.min(100, Math.round((Object.entries(batch.sizes).reduce((sum, [id, size]) => sum + (isInstalled(id, models, detections) ? size : (downloads[id]?.bytes ?? 0)), 0) / batch.total) * 100))
    : 0;
  const preparing = setup && pendingIds.length > 0 && (batch || failure) ? { percent, failure } : null;

  const leftoverIds = setup ? leftovers(models, detections, setup) : [];
  const leftoverBytes = leftoverIds.reduce((sum, id) => sum + sizeOf(id, models, detections), 0);

  const removeLeftovers = async () => {
    setPanelError(null);
    try {
      const b = requireBackend();
      if (!(await b.confirm(`Delete ${leftoverIds.length === 1 ? "one model" : `${leftoverIds.length} models`} no longer in your setup? They can be downloaded again later.`, "Delete"))) return;
      for (const id of leftoverIds) await deleteItem(id);
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
    refreshDetections();
  };

  const download = async (id: string) => {
    setPanelError(null);
    if (setup) {
      setFailed(({ [id]: _, ...rest }) => rest);
      include(id);
      return;
    }
    try {
      await fetchItem(id);
    } catch (error) {
      setPanelError(String(error));
    }
  };

  const downloadDetection = (detection: SpeakerBackend) => download(DETECTION_IDS[detection]);

  const leaveSetup = async (id: string) => {
    setPanelError(null);
    exclude(id);
    try {
      if (downloads[id]) await cancelItem(id);
      else if (isInstalled(id, models, detections)) await deleteItem(id);
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
    refreshDetections();
  };

  const removeDetection = async (detection: SpeakerBackend) => {
    setPanelError(null);
    exclude(DETECTION_IDS[detection]);
    try {
      await deleteItem(DETECTION_IDS[detection]);
    } catch (error) {
      setPanelError(String(error));
    }
    refreshDetections();
  };

  const addFile = async (id: string | null) => {
    const b = backend.current;
    if (!b) {
      setPanelError("The app is still starting. Please try again.");
      return;
    }
    setPanelError(null);
    try {
      const path = await b.pickModelFile();
      if (!path) return;
      const added = await b.addModelFile(id, path);
      setSettings((s) => ({ ...s, modelId: added.id }));
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
  };

  const remove = async (id: string) => {
    setPanelError(null);
    exclude(id);
    try {
      await requireBackend().deleteModel(id);
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
  };

  const unlink = async (id: string) => {
    setPanelError(null);
    try {
      await requireBackend().unlinkModel(id);
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
  };

  const renameModel = async (id: string, name: string) => {
    setPanelError(null);
    try {
      await requireBackend().renameModel(id, name);
    } catch (error) {
      setPanelError(String(error));
    }
    void refreshModels();
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
      const parsed = opened.lines
        ? { lines: opened.lines, timestamps: opened.timestamps ?? entry.timestamps, timed: true }
        : withTimes(parseTranscript(opened.text, entry.speakers ?? []), opened.times);
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
      void b.listHistory().then(setHistory).catch((refreshError) => reportError("Could not refresh history", refreshError));
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

  const showInFolder = async (path: string) => {
    try {
      await requireBackend().reveal(path);
    } catch (error) {
      reportError("Could not show the file in its folder", error);
    }
  };

  const removeHistory = async (id: number) => {
    setHistoryError(null);
    try {
      const entry = history.find((item) => item.id === id);
      if (entry?.file.endsWith(".json") && !(await requireBackend().confirm(`Delete “${entry.title ?? "this transcript"}” from app history?`, "Delete transcript"))) return;
      await requireBackend().removeHistory(id);
    } catch (error) {
      setHistoryError(`Could not remove the history entry: ${String(error)}`);
    }
  };

  const cancelDownload = async (id: string) => {
    exclude(id);
    try {
      await cancelItem(id);
    } catch (error) {
      setPanelError(`Could not cancel the download: ${String(error)}`);
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
            onCancel={() => {
              void Promise.resolve().then(() => requireBackend().cancelRun()).catch((error) => reportError("Could not stop transcription", error));
            }}
            onRestart={(language) => {
              void Promise.resolve()
                .then(() => requireBackend().restartRun(language))
                .catch((error) => dispatch({ type: "fail", message: String(error) }));
            }}
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
            onCopy={async () => {
              try {
                await copyText(transcriptText(run.lines, run.timestamps, run.speakers));
                return true;
              } catch (error) {
                setResultError(`Could not copy the transcript: ${String(error)}`);
                return false;
              }
            }}
            onExport={async (format) => {
              const b = backend.current;
              if (!b || !run.result) return null;
              try {
                const destination = await b.pickExportFile(run.title, format);
                if (!destination) return null;
                const expected = run.hash ?? await b.transcriptHash(run.result.file);
                await b.exportTranscript(run.result.file, expected, destination, run.lines, run.timestamps, run.timed, run.speakers);
                setResultError(null);
                return destination;
              } catch (error) {
                setResultError(`Could not export the transcript: ${String(error)}`);
                return null;
              }
            }}
            onRename={renameTranscript}
            onRenameSpeaker={renameSpeaker}
            onRerun={rerunResult}
            detectionInstalled={speakerBackend !== null}
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
          />
        );
      case "cancelled":
        return (
          <ErrorView
            title="Cancelled"
            message="The transcription was stopped. Any completed lines are saved in app history."
            onRetry={() => dispatch({ type: "reset" })}
          />
        );
      default:
        if (firstRun) {
          return (
            <SetupView
              variant="page"
              models={models}
              detections={detections}
              languages={languages}
              setup={null}
              speed={speed}
              gpu={gpu}
              stats={stats}
              disk={disk}
              busy={running}
              error={setupError ?? panelError}
              leftoverBytes={0}
              showDetails={settings.showDetails}
              onApply={applySetup}
              onMeasureAgain={() => setMeasureAgain((n) => n + 1)}
              onRemoveLeftovers={() => {}}
              onToggleDetails={() => setSettings((s) => ({ ...s, showDetails: !s.showDetails }))}
            >
              {details}
            </SetupView>
          );
        }
        return (
          <DropZone
            ready={model !== null}
            preparing={preparing && setup ? { percent, label: `Downloading the ${MODE_NAMES[setup.mode]} models. A transcription can start once the first model is in.` } : null}
            dragging={dragging}
            pending={pending}
            summary={[
              model?.name ?? "",
              locked ? languageLabel(locked) : settings.language === "auto" ? "Auto-detect" : languageLabel(settings.language),
              !speakerBackend || settings.speakers === "off"
                ? "Speakers not named"
                : `${settings.speakers === "auto" ? "Speakers detected" : speakerBackend === "nemotron" ? `Up to ${settings.speakers} people` : `${settings.speakers} people`}${speakerBackend === "sherpa" && settings.speakerPrecision === "fast" ? ", fast" : ""}`,
              "Saved in app history",
            ]}
            onGo={go}
            onClear={() => setPending(null)}
            onChoose={choose}
            onGetModel={() => setPanel("models")}
          />
        );
    }
  };

  const details = (
    <ModelDetails
      focus={modelsFocus}
      models={models}
      detections={detections}
      downloads={downloads}
      failed={failed}
      setup={setup}
      stats={stats}
      disk={disk}
      speed={speed}
      busy={running}
      folder={folder}
      onDownload={(id) => { void download(id); }}
      onCancelDownload={(id) => { void cancelDownload(id); }}
      onAddFile={addFile}
      onDelete={remove}
      onUnlink={unlink}
      onRename={renameModel}
      onShowFolder={() => { void showInFolder(folder); }}
      onOpenUrl={openUrl}
      onDownloadDetection={(b) => { void downloadDetection(b); }}
      onCancelDetection={(b) => { void cancelDownload(DETECTION_IDS[b]); }}
      onRemoveDetection={removeDetection}
      onLeaveSetup={leaveSetup}
    />
  );

  return (
    <div className="app">
      <TopBar
        theme={settings.theme}
        onTheme={(theme) => setSettings((s) => ({ ...s, theme }))}
        historyOpen={historyOpen}
        onHistory={() => setHistoryOpen((o) => !o)}
        onModels={() => setPanel("models")}
        onAbout={() => {
          setAboutFocus(null);
          setPanel("about");
        }}
        update={topBarLabel(update)}
        onUpdate={() => {
          setAboutFocus("update");
          setPanel("about");
        }}
        busy={running}
      />
      <main>
        {run.status !== "running" && run.status !== "done" && !firstRun && (
        <SettingsBar
          models={models}
          modelId={settings.modelId}
          model={model}
          onModel={(id) => setSettings((s) => ({ ...s, modelId: id }))}
          languages={languageOptions.some((o) => o.value === settings.language) ? languageOptions : [...languageOptions, { value: settings.language, label: languageLabel(settings.language) }]}
          language={settings.language}
          onLanguage={(key) => setSettings((s) => ({ ...s, language: key }))}
          locked={locked}
          speakers={settings.speakers}
          backend={speakerBackend}
          onSpeakers={(value) => setSettings((s) => ({ ...s, speakers: value }))}
          speakerPrecision={settings.speakerPrecision}
          onSpeakerPrecision={(value) => setSettings((s) => ({ ...s, speakerPrecision: value }))}
          onSetUpSpeakers={setUpDetection}
          stats={stats}
          busy={running}
        />
        )}
        {preparing && setup && run.status !== "running" && run.status !== "done" && (
          <SetupProgress
            mode={MODE_NAMES[setup.mode]}
            percent={percent}
            ready={model !== null}
            error={preparing.failure}
            onRetry={() => {
              setFailed({});
              setSetupError(null);
            }}
            onDetails={() => setPanel("models")}
          />
        )}
        <div className="stage">{main()}</div>
      </main>
      <SystemBar stats={stats} running={running} onCredit={() => setPanel("support")} />
      {panel === "models" && (
        <ModelsDialog error={panelError} onClose={closePanel}>
          <SetupView
            variant="dialog"
            models={models}
            detections={detections}
            languages={languages}
            setup={setup}
            speed={speed}
            gpu={gpu}
            stats={stats}
            disk={disk}
            busy={running}
            error={setupError}
            leftoverBytes={leftoverBytes}
            onApply={applySetup}
            onMeasureAgain={() => setMeasureAgain((n) => n + 1)}
            onRemoveLeftovers={() => { void removeLeftovers(); }}
          >
            {details}
          </SetupView>
        </ModelsDialog>
      )}
      {rerunTarget && (
        <RerunDialog
          title={rerunTarget.entry.title ?? titleOf(rerunTarget.entry.file)}
          edited={rerunTarget.entry.edited !== false}
          tracks={!rerunTarget.entry.detected ? (rerunTarget.entry.speakers?.length ?? 0) : 0}
          models={models}
          languages={languageOptions}
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
      {panel === "about" && (
        <AboutDialog
          version={version}
          focus={aboutFocus}
          update={update}
          updateWait={updateWait}
          checkOnStart={settings.checkUpdates}
          onCheckOnStart={(on) => setSettings((s) => ({ ...s, checkUpdates: on }))}
          onCheckUpdate={() => void checkUpdate(false)}
          onUpdate={(v) => void startUpdate(v)}
          onInstallUpdate={(v) => void installUpdate(v)}
          onOpenUrl={openUrl}
          onSupport={support}
          onClose={closePanel}
        />
      )}
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
        onRerun={(entry) => openRerun(entry)}
        onReveal={(path) => { void showInFolder(path); }}
        onRemove={(id) => { void removeHistory(id); }}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryError(null);
        }}
      />
      {appErrors.length > 0 && (
        <div className="problem app-error" role="alert">
          <span>{appErrors[0]}{appErrors.length > 1 && ` (${appErrors.length - 1} more)`}</span>
          <button type="button" className="inline-link" onClick={() => setAppErrors((current) => current.slice(1))}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
