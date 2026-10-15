import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { clock } from "../lib/format";
import { Pause, Play } from "./icons";

export type PlayerHandle = { seek: (seconds: number) => void };

type Props = {
  src: string;
  onTime: (seconds: number, playing: boolean) => void;
  onSeek: (seconds: number) => void;
  onReady: (duration: number) => void;
  onFail: () => void;
};

const SPEEDS = [1, 1.5, 2];

export const AudioPlayer = forwardRef<PlayerHandle, Props>(function AudioPlayer({ src, onTime, onSeek, onReady, onFail }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const play = () => {
    audio.current?.play().catch(() => {});
  };

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const a = audio.current;
      if (!a) return;
      a.currentTime = seconds;
      setTime(seconds);
      play();
    },
  }));

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) play();
    else a.pause();
  };

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div className="player">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          onReady(e.currentTarget.duration);
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime, !e.currentTarget.paused);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={onFail}
      />
      <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        type="range"
        className="seek"
        min={0}
        max={duration || 0}
        step={0.1}
        value={time}
        style={{ ["--progress" as string]: `${progress}%` }}
        onChange={(e) => {
          const a = audio.current;
          if (a) a.currentTime = Number(e.target.value);
          setTime(Number(e.target.value));
          onSeek(Number(e.target.value));
        }}
        aria-label="Position in the recording"
      />
      <span className="player-time">
        {clock(time)} / {clock(duration)}
      </span>
      <button type="button" className="speed" onClick={nextSpeed} title="Playback speed">
        {speed}×
      </button>
    </div>
  );
});
