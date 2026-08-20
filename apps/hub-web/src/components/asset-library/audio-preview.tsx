"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AudioWaveform } from "./audio-waveform";

interface AudioPreviewProps {
  assetId: string;
  name: string;
  waveformData?: number[];
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Interpolates the progress bar color from accent→amber→red
// as playback approaches the end.
function barColor(progress: number): string {
  if (progress < 0.65) return "var(--v2-accent)";
  // 65%–80%: accent → amber
  if (progress < 0.8) {
    const t = (progress - 0.65) / 0.15;
    const r = Math.round(163 + t * (245 - 163));
    const g = Math.round(230 + t * (158 - 230));
    const b = Math.round(53 + t * (11 - 53));
    return `rgb(${r},${g},${b})`;
  }
  // 80%–92%: amber → orange-red
  if (progress < 0.92) {
    const t = (progress - 0.8) / 0.12;
    const r = Math.round(245 + t * (239 - 245));
    const g = Math.round(158 + t * (68 - 158));
    const b = Math.round(11 + t * (68 - 11));
    return `rgb(${r},${g},${b})`;
  }
  // 92%–100%: bright red
  return "rgb(239,68,68)";
}

export function AudioPreview({
  assetId,
  name,
  waveformData = [],
}: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  const progress = duration > 0 ? currentTime / duration : 0;

  const handleTimeUpdate = useCallback(() => {
    setCurrentTime(audioRef.current?.currentTime ?? 0);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(audioRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => setError(true));
      setPlaying(true);
    }
  }, [playing]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      const bar = progressBarRef.current;
      if (!audio || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      audio.currentTime = ratio * duration;
      setCurrentTime(audio.currentTime);
    },
    [duration],
  );

  // Keyboard: space to toggle play when focused
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        togglePlay();
      }
    },
    [togglePlay],
  );

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          gap: 12,
          padding: 40,
          color: "var(--v2-text-2)",
          background: "var(--v2-surface-container)",
          borderRadius: 8,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 48, opacity: 0.3 }}
        >
          audio_file
        </span>
        <p style={{ margin: 0, fontSize: 14 }}>Failed to load audio</p>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          The audio file may be missing or in an unsupported format
        </p>
      </div>
    );
  }

  const color = barColor(progress);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "24px 32px",
        background: "var(--v2-surface-container)",
        borderRadius: 8,
      }}
    >
      {/* Waveform visualization */}
      {waveformData.length > 0 && (
        <div
          data-testid="audio-waveform"
          style={{
            width: "100%",
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AudioWaveform data={waveformData} width={600} height={120} />
        </div>
      )}

      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {/* Play / Pause button */}
        <button
          data-testid="audio-play-pause"
          onClick={togglePlay}
          onKeyDown={handleKeyDown}
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: `rgba(var(--v2-accent-rgb), 0.15)`,
            border: `1px solid rgba(var(--v2-accent-rgb), 0.3)`,
            color: "var(--v2-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>

        {/* Progress bar + times */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* Track */}
          <div
            ref={progressBarRef}
            data-testid="audio-progress-bar"
            onClick={handleSeek}
            style={{
              height: 8,
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              cursor: "pointer",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Filled portion */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                right: `${(1 - progress) * 100}%`,
                background: color,
                borderRadius: 4,
                transition: "background-color 0.4s ease",
              }}
            />
          </div>

          {/* Time labels */}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                color: progress > 0.85 ? color : "rgba(205,195,215,0.6)",
                fontWeight: progress > 0.85 ? 700 : 400,
                transition: "color 0.4s ease",
              }}
            >
              {formatTime(currentTime)}
            </span>
            <span
              style={{
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                color: "rgba(205,195,215,0.35)",
              }}
            >
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Hidden native audio element */}
      <audio
        ref={audioRef}
        data-testid="audio-player"
        src={`/api/assets/${assetId}/stream`}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleError}
        style={{ display: "none" }}
      />
    </div>
  );
}
