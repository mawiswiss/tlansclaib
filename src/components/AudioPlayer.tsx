import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { clock } from "../lib/format";
import { getBackend } from "../lib/ipc";
import { Pause, Play } from "./icons";

export type PlayerHandle = { seek: (seconds: number, play?: boolean) => void; toggle: () => void };

type Props = {
  src: string;
  path?: string;
  onTime: (seconds: number, playing: boolean) => void;
  onFrame?: (seconds: number) => void;
  onSeek: (seconds: number) => void;
  onReady: (duration: number) => void;
  onFail: () => void;
  onPlaybackError: (message: string | null) => void;
};

const SPEEDS = [1, 1.5, 2];
const MAX_BUCKETS = 1000;
const SMALL_STEP = 5;
const BIG_STEP = 30;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const token = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

const Bars = memo(function Bars({ heights, played, hovered }: { heights: number[]; played: number; hovered: number }) {
  const [origin] = useState(() => played / heights.length);
  const [rising, setRising] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setRising(false), token("--duration-wave-rise") + token("--duration-wave-stagger"));
    return () => clearTimeout(timer);
  }, []);

  return (
    <span className={rising ? "wave-bars rising" : "wave-bars"} aria-hidden="true">
      {heights.map((h, i) => (
        <i key={i} className={i === hovered ? "hovered" : i < played ? "played" : undefined} style={{ height: `${h}%`, ["--from" as string]: Math.abs((i + 0.5) / heights.length - origin) }} />
      ))}
    </span>
  );
});

function resample(peaks: number[], count: number): number[] {
  const top = Math.max(0.05, ...peaks);
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * peaks.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
    return Math.max(8, Math.round((peak / top) * 100));
  });
}

export const AudioPlayer = forwardRef<PlayerHandle, Props>(function AudioPlayer({ src, path, onTime, onFrame, onSeek, onReady, onFail, onPlaybackError }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [width, setWidth] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [started, setStarted] = useState(false);
  const [hover, setHover] = useState<{ x: number; top: number; at: number; time: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const still = useRef(0);
  const frame = useRef(onFrame);
  frame.current = onFrame;

  useEffect(() => () => clearTimeout(still.current), []);

  const [bar, gap] = useMemo(() => [token("--size-wave-bar"), token("--size-wave-gap")], []);
  const count = width > 0 ? clamp(Math.floor((width + gap) / (bar + gap)), 1, MAX_BUCKETS) : 0;

  useEffect(() => {
    const el = slider.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPeaks(null);
    setStarted(false);
  }, [path]);

  useEffect(() => {
    if (!path || count === 0) return;
    let active = true;
    const timer = setTimeout(() => {
      getBackend()
        .then((backend) => backend.audioPeaks(path, count))
        .then((result) => active && setPeaks(result && result.length > 0 ? result : null))
        .catch(() => active && setPeaks(null));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path, count]);

  const heights = useMemo(() => {
    if (!peaks || count === 0) return null;
    const bars = resample(peaks, count);
    return bars.some((h) => h !== bars[0]) ? bars : null;
  }, [peaks, count]);
  const wave = started ? heights : null;

  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      if (audio.current) frame.current?.(audio.current.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const play = () => {
    void audio.current?.play().then(() => onPlaybackError(null)).catch((error) => onPlaybackError(`Could not play the recording: ${String(error)}`));
  };

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) play();
    else a.pause();
  };

  useImperativeHandle(ref, () => ({
    seek(seconds: number, andPlay = true) {
      const a = audio.current;
      if (!a) return;
      a.currentTime = seconds;
      setTime(seconds);
      if (andPlay) play();
      else a.pause();
    },
    toggle,
  }));

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const seekTo = (seconds: number) => {
    const a = audio.current;
    if (!a || duration <= 0) return;
    const at = clamp(seconds, 0, duration);
    a.currentTime = at;
    setTime(at);
    onSeek(at);
  };

  const timeAt = (clientX: number): number => {
    const box = slider.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return clamp((clientX - box.left) / box.width, 0, 1) * duration;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    seekTo(timeAt(e.clientX));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    if (dragging.current) seekTo(timeAt(e.clientX));
    if (e.pointerType !== "mouse") return;
    const box = e.currentTarget.getBoundingClientRect();
    const at = box.width > 0 ? clamp((e.clientX - box.left) / box.width, 0, 1) : 0;
    setHover({ x: clamp(e.clientX, 40, window.innerWidth - 40), top: box.top, at, time: at * duration });
    setMoving(true);
    clearTimeout(still.current);
    still.current = window.setTimeout(() => setMoving(false), token("--duration-transition-short"));
  };

  const onPointerEnd = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || duration <= 0) return;
    const jump: Record<string, number> = {
      ArrowLeft: -SMALL_STEP,
      ArrowDown: -SMALL_STEP,
      ArrowRight: SMALL_STEP,
      ArrowUp: SMALL_STEP,
      PageDown: -BIG_STEP,
      PageUp: BIG_STEP,
    };
    if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(duration);
    else if (e.key in jump) seekTo(time + jump[e.key]);
    else return;
    e.preventDefault();
  };

  const progress = duration > 0 ? clamp(time / duration, 0, 1) : 0;

  // Bars spread edge to edge, so bar i starts at i * step. Half a bar of slack counts a bar the cursor touches.
  const barAt = (fraction: number, bars: number) => {
    const step = bars > 1 ? (width - bar) / (bars - 1) : 0;
    return step > 0 ? clamp(Math.floor((fraction * width + bar / 2) / step), 0, bars - 1) : 0;
  };

  return (
    <div className="player">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
          onReady(e.currentTarget.duration);
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime, !e.currentTarget.paused);
        }}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onError={onFail}
      />
      <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div
        ref={slider}
        className="wave-slider"
        role="slider"
        tabIndex={0}
        aria-label="Position in the recording"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time)} of ${clock(duration)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        {wave ? (
          <Bars heights={wave} played={progress > 0 ? barAt(progress, wave.length) + 1 : 0} hovered={hover && moving ? barAt(hover.at, wave.length) : -1} />
        ) : (
          <span className="seek-track">
            <span className="meter">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
            <i className="seek-dot" style={{ left: `${progress * 100}%` }} />
          </span>
        )}
        {hover && <i className="wave-cursor" style={{ left: `${hover.at * 100}%` }} />}
      </div>
      {hover &&
        createPortal(
          <span className="wave-tip" role="tooltip" style={{ left: hover.x, top: hover.top }}>
            {clock(hover.time)}
          </span>,
          document.body,
        )}
      <span className="player-time data tabular">
        {clock(time)} / {clock(duration)}
      </span>
      <button type="button" className="speed data" onClick={nextSpeed} title="Playback speed">
        {speed}×
      </button>
    </div>
  );
});
