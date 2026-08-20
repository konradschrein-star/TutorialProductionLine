"use client";

import { useState, useRef, useEffect } from "react";
import { AudioWaveform } from "../asset-library/audio-waveform";

/**
 * MusicWaveform Component
 *
 * Displays audio waveform with play/pause controls and duration.
 * Reusable across the application for music library visualization.
 *
 * Features:
 * - Canvas-based waveform visualization
 * - Play/pause button
 * - Duration display
 * - Progress indicator
 * - Error handling
 */

interface MusicWaveformProps {
  /** Unique track ID */
  trackId: string;
  /** Track name for display */
  name: string;
  /** Array of amplitude values (0-1) for waveform visualization */
  waveformData?: number[];
  /** Track duration in seconds */
  duration?: number;
  /** Callback when play button is clicked */
  onPlayClick?: (trackId: string, isPlaying: boolean) => void;
  /** Whether the track is currently playing */
  isPlaying?: boolean;
  /** Audio stream URL */
  audioUrl?: string;
  /** Custom waveform height in pixels */
  waveformHeight?: number;
}

export function MusicWaveform({
  trackId,
  name,
  waveformData = [],
  duration = 0,
  onPlayClick,
  isPlaying = false,
  audioUrl = `/api/music-library/${trackId}/stream`,
  waveformHeight = 80,
}: MusicWaveformProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);

  // Sync local playing state with parent playing state
  useEffect(() => {
    setPlaying(isPlaying);
  }, [isPlaying]);

  // Handle audio element play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.play().catch(() => setError(true));
    } else {
      audio.pause();
    }
  }, [playing]);

  const handlePlayClick = () => {
    const newPlaying = !playing;
    setPlaying(newPlaying);
    onPlayClick?.(trackId, newPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
  };

  const handleError = () => {
    setError(true);
    setPlaying(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 120,
          gap: 12,
          padding: 20,
          color: "var(--v2-text-2)",
          background: "rgba(var(--v2-surface-bright-rgb), 0.5)",
          borderRadius: 8,
          border: "1px solid rgba(255, 80, 80, 0.2)",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 32, opacity: 0.3, color: "#ff8080" }}
        >
          error
        </span>
        <p style={{ margin: 0, fontSize: 11, textAlign: "center" }}>
          Failed to load audio track
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 8,
      }}
    >
      {/* Header with play button and track name */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 12,
          alignItems: "center",
        }}
      >
        <button
          onClick={handlePlayClick}
          style={{
            width: 40,
            height: 40,
            background: playing ? "var(--v2-accent)" : "rgba(255,255,255,0.05)",
            border: playing
              ? "none"
              : "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            borderRadius: "50%",
            color: playing ? "#000" : "#e5e2e1",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}
          title={playing ? "Pause" : "Play"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#e5e2e1",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(205,195,215,0.5)",
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        <span
          style={{
            fontSize: 10,
            color: "rgba(205,195,215,0.5)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {duration > 0 ? formatTime(duration) : "Loading..."}
        </span>
      </div>

      {/* Waveform visualization */}
      {waveformData.length > 0 && (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: waveformHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.01)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <AudioWaveform
            data={waveformData}
            width={800}
            height={waveformHeight}
            color="rgba(var(--v2-accent-rgb), 0.7)"
          />

          {/* Progress overlay */}
          {duration > 0 && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${progressPercent}%`,
                height: "100%",
                background: "rgba(var(--v2-accent-rgb), 0.2)",
                pointerEvents: "none",
                transition: "width 0.1s linear",
              }}
            />
          )}
        </div>
      )}

      {/* Hidden audio element for playback */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
        onLoadedMetadata={() => {
          if (audioRef.current && duration === 0) {
            setCurrentTime(0);
          }
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
