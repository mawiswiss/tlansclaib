import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { clock, duration, fileName, folderOf, sourceLabel, speed } from "../lib/format";
import { DETECTION } from "../lib/detection";
import { differs } from "../lib/language";
import type { RunState, Word } from "../lib/run";
import { addSpeaker, assignSpeaker, EXPORT_NAMES, MAX_SPEAKERS, findMatches, joinLine, placeWords, playingAt, removeUnusedSpeakers, splitLine, wordAt, type Playing, type Transcript } from "../lib/transcript";
import type { ExportFormat } from "../lib/types";
import { FEATURES } from "../lib/ipc";
import { AudioPlayer, type PlayerHandle } from "./AudioPlayer";
import { Check, ChevronDown, Close, Download, Folder, Info, Pencil, Plus, Retry, Search } from "./icons";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";

type Props = {
  run: RunState;
  error: string | null;
  noTimecodes: boolean;
  timecodes: boolean;
  onTimecodes: (on: boolean) => void;
  languageName: (code: string) => string;
  audioUrl: (path: string) => Promise<string>;
  onLocateAudio: () => void;
  onRevealAudio: () => void;
  onSave: (change: (current: Transcript) => Transcript | null) => Promise<Transcript | null>;
  onLog: (level: "info" | "warn", message: string) => void;
  onExport: (format: ExportFormat) => Promise<string | null>;
  onRename: (title: string) => Promise<boolean>;
  onRenameSpeaker: (track: number, name: string) => Promise<boolean>;
  onRerun: (options?: { focus?: "speakers" | "language"; speakers?: string; language?: string }) => void;
  detectionInstalled: boolean;
  onSetUpDetection: () => void;
  onClose: () => void;
  onAnother: () => void;
  children?: ReactNode;
};

function when(ms: number): string {
  const date = new Date(ms);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: thisYear ? undefined : "numeric", hour: "2-digit", minute: "2-digit" });
}

const NEW_SPEAKER = "new";

function flat(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

function marked(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, at + query.length)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return parts;
}

type Held = { row: number; index: number; from: number; until: number };

const SEEK_SLACK = 0.25;

function usePlayhead() {
  return useMemo(() => {
    let now = 0;
    let held: Held | null = null;
    const listeners = new Set<() => void>();
    return {
      get: () => now,
      set: (seconds: number) => {
        now = seconds;
        if (held && (seconds >= held.until || seconds < held.from - SEEK_SLACK)) held = null;
        listeners.forEach((listener) => listener());
      },
      /** Keeps a clicked word marked while playback runs up to it from the word before. */
      hold: (word: Held | null) => {
        held = word;
      },
      heldIn: (row: number) => (held?.row === row ? held.index : -1),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }, []);
}

type Playhead = ReturnType<typeof usePlayhead>;

const still = () => () => {};

type SpokenProps = { row: number; start: number; text: string; words: Word[]; live: boolean; playhead: Playhead; onWord: (word: Held) => void };

const Spoken = memo(function Spoken({ row, start, text, words, live, playhead, onWord }: SpokenProps) {
  const placed = useMemo(() => placeWords(text, words), [text, words]);
  const now = useSyncExternalStore(live ? playhead.subscribe : still, () => {
    if (!live) return -1;
    const held = playhead.heldIn(row);
    return held >= 0 ? held : wordAt(placed, playhead.get());
  });
  const parts: ReactNode[] = [];
  let from = 0;
  placed.forEach(({ word, from: at, to }, i) => {
    parts.push(text.slice(from, at));
    parts.push(
      <span
        key={i}
        className={i === now ? "word now" : "word"}
        onClick={(e) => {
          e.stopPropagation();
          onWord({ row, index: i, from: i > 0 ? placed[i - 1].word.start : start, until: word.start });
        }}
      >
        {word.text}
      </span>,
    );
    from = to;
  });
  parts.push(text.slice(from));
  return parts;
});

export function ResultView(props: Props) {
  const {
    run,
    error,
    noTimecodes,
    timecodes,
    onTimecodes,
    languageName,
    audioUrl,
    onLocateAudio,
    onRevealAudio,
    onSave,
    onLog,
    onExport,
    onRename,
    onRenameSpeaker,
    onRerun,
    detectionInstalled,
    onSetUpDetection,
    onClose,
    onAnother,
    children,
  } = props;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [lastEdit, setLastEdit] = useState<Transcript | null>(null);
  const committing = useRef(false);
  const editingNow = useRef<number | null>(null);
  const caret = useRef<number | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [chosenFormat, setFormat] = useState<ExportFormat>("txt");
  const [src, setSrc] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [heard, setHeard] = useState<Playing>({ lines: [], main: -1 });
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const player = useRef<PlayerHandle>(null);
  const playhead = usePlayhead();
  const search = useRef<HTMLInputElement>(null);
  const rows = useRef<(HTMLParagraphElement | null)[]>([]);
  const userScrolled = useRef(0);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const renameOpen = useRef(false);
  const renameBusy = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const [speakerEdit, setSpeakerEdit] = useState<number | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState("");
  const speakerOpen = useRef<number | null>(null);
  const speakerBusy = useRef(false);
  const speakerInput = useRef<HTMLInputElement>(null);

  const result = run.result!;
  const title = run.title;
  const spoken = differs(run.language, run.heard);
  const lines = useMemo(() => run.lines.flatMap((l, index) => (l.text ? [{ ...l, index }] : [])), [run.lines]);
  const audioMissing = run.check?.audio === "missing";
  const audioChanged = run.check?.audio === "different";
  const needle = query.trim().toLowerCase();
  const hits = useMemo(() => findMatches(lines, needle), [lines, needle]);
  const syncable = run.timed && src !== null && !unplayable;
  const format = run.timed ? chosenFormat : "txt";
  const transcriptionSpeed = run.audioSeconds !== null ? speed(run.audioSeconds, result.elapsed) : "";
  const download = (to: ExportFormat) => { void onExport(to).then(setExported); };

  useEffect(() => setExported(null), [result.file]);

  useEffect(() => {
    setSrc(null);
    setUnplayable(false);
    setPlayerError(null);
    setHeard({ lines: [], main: -1 });
    if (audioMissing) return;
    let active = true;
    audioUrl(run.audio)
      .then((url) => active && setSrc(url))
      .catch((e) => {
        if (!active) return;
        setUnplayable(true);
        setPlayerError(`Could not load the recording: ${String(e)}`);
        onLog("warn", "could not load the recording for playback");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.audio, audioMissing]);

  useEffect(() => {
    setHit(0);
  }, [needle]);

  useEffect(() => {
    if (hits.length === 0) return;
    rows.current[hits[hit]]?.scrollIntoView({ block: "center" });
  }, [hits, hit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draft]);

  useLayoutEffect(() => {
    const el = editor.current;
    if (!el) return;
    const at = caret.current ?? el.value.length;
    caret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [editing]);

  useEffect(() => {
    if (!lastEdit) return;
    const t = setTimeout(() => setLastEdit(null), 8000);
    return () => clearTimeout(t);
  }, [lastEdit]);

  useLayoutEffect(() => {
    if (renaming) titleInput.current?.select();
  }, [renaming]);

  useLayoutEffect(() => {
    if (speakerEdit !== null) speakerInput.current?.select();
  }, [speakerEdit]);

  const startSpeakerRename = (track: number, name: string) => {
    speakerOpen.current = track;
    setSpeakerDraft(name);
    setSpeakerEdit(track);
  };

  const closeSpeakerRename = () => {
    speakerOpen.current = null;
    setSpeakerEdit(null);
  };

  const commitSpeakerRename = async (fromEnter: boolean) => {
    const track = speakerOpen.current;
    if (track === null || speakerBusy.current) return;
    const name = speakerDraft.replace(/\s+/g, " ").trim();
    if (!name || name === run.speakers[track]) {
      closeSpeakerRename();
      return;
    }
    speakerBusy.current = true;
    const saved = await onRenameSpeaker(track, name);
    speakerBusy.current = false;
    if (saved || !fromEnter) closeSpeakerRename();
  };

  const startRename = () => {
    renameOpen.current = true;
    setTitleDraft(title);
    setRenaming(true);
  };

  const closeRename = () => {
    renameOpen.current = false;
    setRenaming(false);
  };

  const commitRename = async (fromEnter: boolean) => {
    if (!renameOpen.current || renameBusy.current) return;
    const next = titleDraft.replace(/\s+/g, " ").trim();
    if (!next || next === title) {
      closeRename();
      return;
    }
    renameBusy.current = true;
    const renamed = await onRename(next);
    renameBusy.current = false;
    if (renamed || !fromEnter) closeRename();
  };

  const startEdit = (index: number | null, text = "") => {
    editingNow.current = index;
    setEditing(index);
    setDraft(text);
  };

  const save = async (change: (current: Transcript) => Transcript | null): Promise<Transcript | null> => {
    const before = await onSave(change);
    if (before) setLastEdit(before);
    return before;
  };

  const saveEdit = async (index: number, change: (current: Transcript) => Transcript | null): Promise<boolean> => {
    if (editingNow.current !== index || committing.current) return false;
    committing.current = true;
    const saved = await save(change);
    committing.current = false;
    return saved !== null;
  };

  const commit = async (index: number) => {
    const text = flat(draft).trim();
    if (editingNow.current === index && text === run.lines[index].text) {
      startEdit(null);
      return;
    }
    if (await saveEdit(index, (t) => removeUnusedSpeakers({ ...t, lines: t.lines.map((l, i) => (i === index ? { ...l, text } : l)) }))) startEdit(null);
  };

  const split = async (index: number, at: number) => {
    const before = flat(draft.slice(0, at));
    const after = flat(draft.slice(at)).trim();
    if (!(await saveEdit(index, (t) => ({ ...t, lines: splitLine(t.lines, index, before + after, before.length, t.speakers.length) })))) return;
    caret.current = 0;
    startEdit(index + 1, after);
  };

  const join = async (index: number) => {
    const joined = joinLine(run.lines, index, flat(draft));
    if (!joined || !(await saveEdit(index, (t) => removeUnusedSpeakers({ ...t, lines: joinLine(t.lines, index, flat(draft))?.lines ?? t.lines })))) return;
    caret.current = joined.at;
    startEdit(joined.index, joined.lines[joined.index].text);
  };

  const renameNewest = (saved: Transcript | null) => {
    if (!saved) return;
    const named = addSpeaker(saved.speakers, saved.lines).speakers;
    startSpeakerRename(named.length - 1, named[named.length - 1]);
  };

  const reassign = async (index: number, value: string) => {
    if (value !== NEW_SPEAKER) {
      await save((t) => removeUnusedSpeakers({ ...t, lines: assignSpeaker(t.lines, index, Number(value)) }));
      return;
    }
    let newest: [number, string] = [-1, ""];
    const saved = await save((t) => {
      const added = addSpeaker(t.speakers, t.lines);
      const next = removeUnusedSpeakers({ ...added, lines: assignSpeaker(added.lines, index, added.speakers.length - 1) });
      newest = [next.speakers.length - 1, next.speakers[next.speakers.length - 1]];
      return next;
    });
    if (saved && newest[0] >= 0) startSpeakerRename(newest[0], newest[1]);
  };

  const addOne = async () => renameNewest(await save((t) => addSpeaker(t.speakers, t.lines)));

  const undo = async () => {
    if (!lastEdit) return;
    const before = lastEdit;
    setLastEdit(null);
    await onSave(() => before);
    setLastEdit(null);
  };

  const onTime = (seconds: number, playing: boolean) => {
    playhead.set(seconds);
    if (!run.timed) return;
    const next = playingAt(lines, seconds);
    if (next.main === heard.main && next.lines.join() === heard.lines.join()) return;
    setHeard(next);
    if (playing && next.main >= 0 && next.main !== heard.main && Date.now() - userScrolled.current > 4000) {
      rows.current[next.main]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const onSeek = (seconds: number) => {
    playhead.hold(null);
    playhead.set(seconds);
    if (!run.timed) return;
    const next = playingAt(lines, seconds);
    setHeard(next);
    userScrolled.current = 0;
    if (next.main >= 0) rows.current[next.main]?.scrollIntoView({ block: "center" });
  };

  const playWord = useCallback(
    (word: Held) => {
      playhead.hold(word);
      player.current?.seek(word.from);
      playhead.set(word.from);
      setHeard({ lines: [word.row], main: word.row });
      userScrolled.current = 0;
    },
    [playhead],
  );

  const step = (delta: number) => {
    if (hits.length > 0) setHit((h) => (h + delta + hits.length) % hits.length);
  };

  return (
    <section className="result">
      <div className="result-head">
        <div className="card result-card">
          <span className="glyph ok-glyph">
            <Check size={20} strokeWidth={2.4} />
          </span>
          <div className="titles">
            {renaming ? (
              <input
                ref={titleInput}
                type="text"
                className="title-editor"
                value={titleDraft}
                maxLength={120}
                spellCheck={false}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitRename(false)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitRename(true);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    closeRename();
                  }
                }}
                aria-label="Transcript title"
              />
            ) : (
              <h2 className="title-line">
                <span className="title-text" onDoubleClick={startRename} title={title}>
                  {title}
                </span>
                <button type="button" className="icon-button tiny title-edit" onClick={startRename} aria-label="Rename" title="Rename the transcript">
                  <Pencil size={14} />
                </button>
              </h2>
            )}
          </div>
          <div className="card-tools">
            <div className="split-button">
              <button type="button" className="primary small" onClick={() => download(format)}>
                <Download size={16} />
                Download .{format}
              </button>
              <Select
                value=""
                options={(Object.keys(EXPORT_NAMES) as ExportFormat[]).map((f) => ({ value: f, label: `${EXPORT_NAMES[f]} (.${f})` }))}
                onChange={(f) => {
                  setFormat(f as ExportFormat);
                  download(f as ExportFormat);
                }}
                label="Download format"
                title={run.timed ? "Choose a format" : "Subtitles need line times, so this transcript downloads as text"}
                disabled={!run.timed}
                className="primary small"
                trigger={() => null}
              />
            </div>
            <Tooltip content={audioMissing ? "The recording is missing, so it cannot be transcribed again" : "Transcribe again with the same settings"} oneLine>
              <button type="button" className="icon-button" onClick={() => onRerun()} disabled={audioMissing} aria-label="Transcribe again">
                <Retry />
              </button>
            </Tooltip>
            <Tooltip content="Close" oneLine>
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                <Close size={17} />
              </button>
            </Tooltip>
          </div>
          <div className="result-details">
            <p className="meta-line">
              <span className="meta-text">
                {[
                  run.finishedAt !== null ? when(run.finishedAt) : null,
                  run.audioSeconds !== null ? clock(run.audioSeconds) : null,
                  sourceLabel(run.audio, run.video, run.detected ? 1 : run.tracks),
                  run.language ? languageName(run.language) : null,
                  run.modelName || null,
                  run.detected ? `${run.speakerBackend ? `${DETECTION[run.speakerBackend].name}: ` : ""}${run.speakers.length > 1 ? `${run.speakers.length} people` : "1 person"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <Tooltip
                content={`Transcribed in ${duration(result.elapsed)}.${transcriptionSpeed ? ` Speed: ${transcriptionSpeed}.` : ""}`}
                oneLine
              >
                <span className="meta-info" tabIndex={0} aria-label="Transcription speed">
                  <Info size={14} />
                </span>
              </Tooltip>
            </p>
            <div className="original-file">
              {audioMissing || audioChanged ? (
                <span className="original-file-reference">
                  <span className="original-file-path" title={run.audio}>{FEATURES.revealFiles ? run.audio : fileName(run.audio)}</span>
                  <span className="chip warn">{audioMissing ? "File missing" : "Different file"}</span>
                  <button type="button" className="inline-link" onClick={onLocateAudio}>Locate…</button>
                </span>
              ) : FEATURES.revealFiles ? (
                <button type="button" className="original-file-link" onClick={onRevealAudio} title={`Show ${fileName(run.audio)} in its folder`}>
                  <Folder size={14} />
                  <span>{run.audio}</span>
                </button>
              ) : (
                <span className="original-file-reference">
                  <span className="original-file-path">{fileName(run.audio)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <Tooltip content="Transcribe another" oneLine className="another-anchor">
          <button type="button" className="another" onClick={onAnother} aria-label="Transcribe another">
            <span className="another-glyph">
              <Plus size={30} strokeWidth={1.5} />
            </span>
          </button>
        </Tooltip>
      </div>
      {error && <p className="problem" role="alert">{error}</p>}
      {exported && <p className="note" role="status">Saved to {exported}.</p>}
      {run.opened?.status === "incomplete" && <p className="note">This transcription was stopped early and holds the lines done until then.</p>}
      {run.check?.changed && <p className="note">This transcript was changed outside tlansclaib since it was saved.</p>}
      {spoken && run.language && (
        <p className="note">
          This sounds like {languageName(spoken)}, but was transcribed as {languageName(run.language)}.{" "}
          <button type="button" className="inline-link" onClick={() => onRerun({ focus: "language", language: spoken })}>
            Transcribe again in {languageName(spoken)}
          </button>
        </p>
      )}
      {run.check?.audio === "different" && (
        <p className="note">
          The recording at this place is not the one that was transcribed.{" "}
          <button type="button" className="inline-link" onClick={onLocateAudio}>
            Locate the original…
          </button>
        </p>
      )}
      {noTimecodes && <p className="note">This transcript was saved without timecodes, so there are none to show or play from.</p>}
      {lastEdit && (
        <p className="note">
          Correction saved.{" "}
          <button type="button" className="inline-link" onClick={undo}>
            Undo
          </button>
        </p>
      )}
      {children}
      <div className="card transcript-card">
        <div className="transcript-tools">
          {audioMissing ? (
            <p className="player-note">
              {FEATURES.revealFiles ? (
                <>
                  <span className="problem-text">Recording not found</span> at {folderOf(run.audio)}.{" "}
                </>
              ) : (
                <>The browser forgets recordings when the page reloads. </>
              )}
              <button type="button" className="inline-link" onClick={onLocateAudio}>
                Locate…
              </button>
            </p>
          ) : unplayable ? (
            <p className="player-note problem" role="alert">{playerError ?? "This recording cannot be played by the system player."}</p>
          ) : src ? (
            <AudioPlayer
              ref={player}
              src={src}
              onTime={onTime}
              onFrame={playhead.set}
              onSeek={onSeek}
              onReady={(d) => onLog("info", `playing a recording, ${Math.round(d)} s`)}
              onPlaybackError={setPlayerError}
              onFail={() => {
                setUnplayable(true);
                setPlayerError("This recording cannot be played by the system player.");
                onLog("warn", "the system player cannot play the recording");
              }}
            />
          ) : (
            <p className="player-note muted">Loading the recording…</p>
          )}
        </div>
        {playerError && !unplayable && <p className="problem" role="alert">{playerError}</p>}
        <div className="transcript-bar">
          {run.speakers.length > 1 ? (
            <div className="speakers-group">
              <span className="speakers-label">Speakers</span>
              {run.speakers.map((name, track) =>
                speakerEdit === track ? (
                  <input
                    key={track}
                    ref={speakerInput}
                    type="text"
                    className={`speaker-editor s${track % 8}`}
                    value={speakerDraft}
                    maxLength={40}
                    size={Math.max(8, speakerDraft.length + 1)}
                    spellCheck={false}
                    onChange={(e) => setSpeakerDraft(e.target.value)}
                    onBlur={() => void commitSpeakerRename(false)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitSpeakerRename(true);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        closeSpeakerRename();
                      }
                    }}
                    aria-label={`Name of speaker ${track + 1}`}
                  />
                ) : (
                  <button
                    key={track}
                    type="button"
                    className={`speaker-chip s${track % 8}`}
                    onClick={() => startSpeakerRename(track, name)}
                    title="Click to rename"
                  >
                    <span className="speaker-dot" />
                    {name}
                    <Pencil size={12} />
                  </button>
                ),
              )}
              {run.detected && !audioMissing && (
                <button
                  type="button"
                  className="inline-link wrong-count"
                  onClick={() => onRerun({ focus: "speakers", speakers: String(Math.min(6, Math.max(2, run.speakers.length))) })}
                >
                  Wrong number?
                </button>
              )}
              <Tooltip content="Speakers come from the audio tracks of the recording, or from speaker detection. A new name is saved in app history right away.">
                <span className="meta-info" tabIndex={0} aria-label="About speakers">
                  <Info size={14} />
                </span>
              </Tooltip>
            </div>
          ) : (
            <span className="speakers-note">
              <span>{run.detected ? "1 person detected" : "One speaker"}</span>
              {lines.length > 0 && (
                <button type="button" className="inline-link" onClick={() => void addOne()}>
                  Add a speaker
                </button>
              )}
              {!audioMissing && FEATURES.speakers &&
                (!detectionInstalled ? (
                  <button type="button" className="inline-link" onClick={onSetUpDetection}>
                    Set up speaker detection
                  </button>
                ) : (
                  <button type="button" className="inline-link" onClick={() => onRerun({ focus: "speakers", speakers: "2" })}>
                    More people in this audio?
                  </button>
                ))}
            </span>
          )}
          <label className="find">
            <Search size={15} />
            <input
              ref={search}
              type="text"
              placeholder="Find in transcript"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
                if (e.key === "Escape") setQuery("");
              }}
              aria-label="Find in transcript"
            />
            {needle && <span className="find-count">{hits.length ? `${hit + 1} of ${hits.length}` : "No matches"}</span>}
            {needle && (
              <>
                <button type="button" className="icon-button tiny" onClick={() => step(-1)} disabled={!hits.length} aria-label="Previous match">
                  <ChevronDown size={14} className="flip" />
                </button>
                <button type="button" className="icon-button tiny" onClick={() => step(1)} disabled={!hits.length} aria-label="Next match">
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="icon-button tiny" onClick={() => setQuery("")} aria-label="Clear the search">
                  <Close size={13} />
                </button>
              </>
            )}
          </label>
          <label
            className="tool-switch"
            title={noTimecodes ? "This transcript has no times to show" : "Show line times here and in text exports"}
          >
            <input
              type="checkbox"
              role="switch"
              className="toggle"
              checked={timecodes}
              disabled={noTimecodes}
              onChange={(e) => onTimecodes(e.target.checked)}
            />
            <span>Timecodes</span>
          </label>
        </div>
        <div
          className="transcript"
          onWheel={() => (userScrolled.current = Date.now())}
          onTouchMove={() => (userScrolled.current = Date.now())}
        >
          {lines.length === 0 && <p className="muted">(nothing recognised)</p>}
          {lines.map((line, i) => {
            const isEditing = editing === line.index;
            const classes = [
              run.timestamps ? "timed" : "",
              run.speakers.length > 1 ? "voiced" : "",
              syncable && !isEditing ? "seekable" : "",
              heard.lines.includes(i) ? "current" : "",
              hits.length > 0 && hits[hit] === i ? "hit" : "",
              isEditing ? "editing" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <p
                key={i}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                className={classes || undefined}
                onClick={
                  syncable && !isEditing
                    ? () => {
                        playhead.hold(null);
                        player.current?.seek(line.start);
                        setHeard({ lines: [i], main: i });
                        userScrolled.current = 0;
                      }
                    : undefined
                }
                title={syncable && !isEditing ? "Play from here" : undefined}
              >
                {run.timestamps && <span className="time">{clock(line.start)}</span>}
                {run.speakers.length > 1 && (
                  <span className="dot-pick" onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={line.speaker !== undefined ? String(line.speaker) : ""}
                      options={[...run.speakers.map((name, track) => ({ value: String(track), label: name })), ...(run.speakers.length < MAX_SPEAKERS ? [{ value: NEW_SPEAKER, label: "New speaker" }] : [])]}
                      onChange={(value) => void reassign(line.index, value)}
                      label="Speaker of this line"
                      title={line.speaker !== undefined ? run.speakers[line.speaker] : "Choose the speaker"}
                      className="dot-select"
                      chevron={false}
                      trigger={() => <span className={`line-dot ${line.speaker !== undefined ? `s${line.speaker % 8}` : "unassigned"}`} />}
                    />
                  </span>
                )}
                {isEditing ? (
                  <textarea
                    ref={editor}
                    className="line-editor"
                    value={draft}
                    rows={1}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => void commit(line.index)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      const { selectionStart: from, selectionEnd: to, value } = e.currentTarget;
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (from === to && value.slice(0, from).trim() && value.slice(from).trim()) void split(line.index, from);
                        else void commit(line.index);
                      }
                      if (e.key === "Backspace" && from === 0 && to === 0) {
                        e.preventDefault();
                        void join(line.index);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(null);
                      }
                    }}
                    aria-label="Edit this line"
                  />
                ) : (
                  <span onDoubleClick={() => startEdit(line.index, line.text)}>
                    {syncable && line.words?.length && !needle ? (
                      <Spoken row={i} start={line.start} text={line.text} words={line.words} live={heard.lines.includes(i)} playhead={playhead} onWord={playWord} />
                    ) : (
                      marked(line.text, needle)
                    )}
                  </span>
                )}
                {!isEditing && (
                  <button
                    type="button"
                    className="icon-button tiny line-edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(line.index, line.text);
                    }}
                    aria-label="Edit this line"
                    title="Edit this line"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </p>
            );
          })}
        </div>
      </div>
    </section>
  );
}
