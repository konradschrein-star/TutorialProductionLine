"use client";

import { useState, useRef, useEffect } from "react";

interface MusicTrack {
  id: string;
  name: string;
  original_filename: string;
  mood: string[] | null;
  bpm: number | null;
  genre: string | null;
  duration_seconds: number | null;
  created_at: string;
}

interface MusicSelectorProps {
  selectedTrackId: string | null | undefined;
  onSelect: (trackId: string | null) => void;
}

const MOOD_OPTIONS = [
  "Upbeat",
  "Energetic",
  "Calm",
  "Dramatic",
  "Suspenseful",
  "Happy",
  "Sad",
  "Inspiring",
  "Dark",
  "Light",
];

export function MusicSelector({
  selectedTrackId,
  onSelect,
}: MusicSelectorProps) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMood, setFilterMood] = useState<string[]>([]);
  const [filterBpmMin, setFilterBpmMin] = useState(0);
  const [filterBpmMax, setFilterBpmMax] = useState(200);
  const [filterGenre, setFilterGenre] = useState("");
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadTracks();
  }, []);

  const loadTracks = async () => {
    try {
      const res = await fetch("/api/music-library");
      if (!res.ok) throw new Error("Failed to load tracks");
      const data = await res.json();
      setTracks(data.tracks || []);
    } catch (error) {
      console.error("Failed to load tracks:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (trackId: string) => {
    if (playingTrack === trackId) {
      audioRef.current?.pause();
      setPlayingTrack(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = `/api/music-library/${trackId}/stream`;
        audioRef.current.play();
      }
      setPlayingTrack(trackId);
    }
  };

  const filteredTracks = tracks.filter((track) => {
    if (filterMood.length > 0) {
      const trackMoods = track.mood || [];
      if (!filterMood.some((mood) => trackMoods.includes(mood))) return false;
    }
    if (
      track.bpm !== null &&
      (track.bpm < filterBpmMin || track.bpm > filterBpmMax)
    ) {
      return false;
    }
    if (filterGenre && track.genre !== filterGenre) return false;
    return true;
  });

  const genres = Array.from(
    new Set(
      tracks
        .map((t) => t.genre)
        .filter((g): g is string => typeof g === "string" && g.length > 0),
    ),
  );

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "Unknown";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: "rgba(205,195,215,0.5)",
        }}
      >
        Loading tracks...
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 16,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <audio
        ref={audioRef}
        onEnded={() => setPlayingTrack(null)}
        style={{ display: "none" }}
      />

      {/* Filters */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "rgba(205,195,215,0.6)",
              marginBottom: 8,
            }}
          >
            Filter by Mood
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MOOD_OPTIONS.map((mood) => (
              <button
                key={mood}
                type="button"
                onClick={() => {
                  const newMoods = filterMood.includes(mood)
                    ? filterMood.filter((m) => m !== mood)
                    : [...filterMood, mood];
                  setFilterMood(newMoods);
                }}
                style={{
                  padding: "4px 10px",
                  background: filterMood.includes(mood)
                    ? "var(--v2-accent)"
                    : "rgba(255,255,255,0.03)",
                  border: filterMood.includes(mood)
                    ? "none"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 4,
                  color: filterMood.includes(mood) ? "#000" : "#e5e2e1",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {mood}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 6,
              }}
            >
              BPM Min: {filterBpmMin}
            </label>
            <input
              type="range"
              min="0"
              max="200"
              value={filterBpmMin}
              onChange={(e) => setFilterBpmMin(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 6,
              }}
            >
              BPM Max: {filterBpmMax}
            </label>
            <input
              type="range"
              min="0"
              max="200"
              value={filterBpmMax}
              onChange={(e) => setFilterBpmMax(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 6,
              }}
            >
              Genre
            </label>
            <select
              value={filterGenre}
              onChange={(e) => setFilterGenre(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 10px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 11,
                outline: "none",
              }}
            >
              <option value="">All Genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Track List */}
      <div
        style={{
          maxHeight: 300,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {filteredTracks.length === 0 ? (
          <p
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              textAlign: "center",
              padding: 20,
            }}
          >
            No tracks found. Upload tracks in Settings.
          </p>
        ) : (
          filteredTracks.map((track) => {
            const isSelected = selectedTrackId === track.id;
            return (
              <div
                key={track.id}
                style={{
                  background: isSelected
                    ? "rgba(var(--v2-accent-rgb), 0.15)"
                    : "rgba(255,255,255,0.03)",
                  border: isSelected
                    ? "1px solid var(--v2-accent)"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  borderRadius: 6,
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => handlePlay(track.id)}
                  style={{
                    width: 32,
                    height: 32,
                    background:
                      playingTrack === track.id
                        ? "var(--v2-accent)"
                        : "rgba(255,255,255,0.05)",
                    border:
                      playingTrack === track.id
                        ? "none"
                        : "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                    borderRadius: "50%",
                    color: playingTrack === track.id ? "#000" : "#e5e2e1",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {playingTrack === track.id ? "pause" : "play_arrow"}
                  </span>
                </button>

                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#e5e2e1",
                      marginBottom: 2,
                    }}
                  >
                    {track.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(205,195,215,0.5)",
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{formatDuration(track.duration_seconds)}</span>
                    {track.bpm && <span>{track.bpm} BPM</span>}
                    {track.genre && <span>{track.genre}</span>}
                  </div>
                  {track.mood && track.mood.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        marginTop: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      {track.mood.map((mood) => (
                        <span
                          key={mood}
                          style={{
                            padding: "1px 6px",
                            background: "rgba(var(--v2-accent-rgb), 0.15)",
                            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                            borderRadius: 3,
                            fontSize: 8,
                            fontWeight: 600,
                            color: "var(--v2-accent)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {mood}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onSelect(isSelected ? null : track.id)}
                  style={{
                    padding: "6px 12px",
                    background: isSelected
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.05)",
                    border: isSelected
                      ? "none"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                    borderRadius: 6,
                    color: isSelected ? "#000" : "#e5e2e1",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {isSelected ? "Selected" : "Select"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
