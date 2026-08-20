"use client";

import { useState, useRef } from "react";

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

interface MusicLibraryManagerProps {
  tracks: MusicTrack[];
  onRefresh: () => void;
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

export function MusicLibraryManager({
  tracks,
  onRefresh,
}: MusicLibraryManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [filterMood, setFilterMood] = useState<string[]>([]);
  const [filterBpmMin, setFilterBpmMin] = useState(0);
  const [filterBpmMax, setFilterBpmMax] = useState(200);
  const [filterGenre, setFilterGenre] = useState("");
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [uploadForm, setUploadForm] = useState({
    name: "",
    file: null as File | null,
    mood: [] as string[],
    bpm: "",
    genre: "",
  });

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.file || !uploadForm.name) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      formData.append("name", uploadForm.name);
      formData.append("mood", JSON.stringify(uploadForm.mood));
      formData.append("bpm", uploadForm.bpm);
      formData.append("genre", uploadForm.genre);

      const res = await fetch("/api/music-library", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      setUploadForm({ name: "", file: null, mood: [], bpm: "", genre: "" });
      onRefresh();
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload music track");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (trackId: string) => {
    if (!confirm("Delete this track?")) return;

    try {
      const res = await fetch(`/api/music-library/${trackId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Delete failed");

      onRefresh();
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete track");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <audio
        ref={audioRef}
        onEnded={() => setPlayingTrack(null)}
        style={{ display: "none" }}
      />

      {/* Upload Form */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 16,
          }}
        >
          Upload Music Track
        </h3>

        <form
          onSubmit={handleUpload}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 16,
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
                  marginBottom: 8,
                }}
              >
                Track Name
              </label>
              <input
                type="text"
                value={uploadForm.name}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, name: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
                required
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
                  marginBottom: 8,
                }}
              >
                Audio File
              </label>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) =>
                  setUploadForm({
                    ...uploadForm,
                    file: e.target.files?.[0] || null,
                  })
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
                required
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
                  marginBottom: 8,
                }}
              >
                BPM
              </label>
              <input
                type="number"
                value={uploadForm.bpm}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, bpm: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
                min="0"
                max="300"
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
                  marginBottom: 8,
                }}
              >
                Genre
              </label>
              <input
                type="text"
                value={uploadForm.genre}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, genre: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
                placeholder="e.g., Electronic, Ambient"
              />
            </div>
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
                marginBottom: 8,
              }}
            >
              Mood Tags
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MOOD_OPTIONS.map((mood) => (
                <button
                  key={mood}
                  type="button"
                  onClick={() => {
                    const newMoods = uploadForm.mood.includes(mood)
                      ? uploadForm.mood.filter((m) => m !== mood)
                      : [...uploadForm.mood, mood];
                    setUploadForm({ ...uploadForm, mood: newMoods });
                  }}
                  style={{
                    padding: "6px 12px",
                    background: uploadForm.mood.includes(mood)
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.03)",
                    border: uploadForm.mood.includes(mood)
                      ? "none"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    borderRadius: 6,
                    color: uploadForm.mood.includes(mood) ? "#000" : "#e5e2e1",
                    fontSize: 11,
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

          <button
            type="submit"
            disabled={uploading}
            style={{
              padding: "12px 20px",
              background: uploading
                ? "rgba(var(--v2-accent-rgb), 0.3)"
                : "var(--v2-accent)",
              border: "none",
              borderRadius: 8,
              color: "#000",
              fontSize: 12,
              fontWeight: 700,
              cursor: uploading ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {uploading ? "Uploading..." : "Upload Track"}
          </button>
        </form>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 16,
          }}
        >
          Filter Tracks
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
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
              Mood
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
                    padding: "6px 12px",
                    background: filterMood.includes(mood)
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.03)",
                    border: filterMood.includes(mood)
                      ? "none"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    borderRadius: 6,
                    color: filterMood.includes(mood) ? "#000" : "#e5e2e1",
                    fontSize: 11,
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
              gap: 16,
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
                  marginBottom: 8,
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
                  marginBottom: 8,
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
                  marginBottom: 8,
                }}
              >
                Genre
              </label>
              <select
                value={filterGenre}
                onChange={(e) => setFilterGenre(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color: "#e5e2e1",
                  fontSize: 12,
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
      </div>

      {/* Track List */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
            marginBottom: 16,
          }}
        >
          Music Library ({filteredTracks.length} tracks)
        </h3>

        {filteredTracks.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: "rgba(205,195,215,0.5)",
              textAlign: "center",
              padding: 20,
            }}
          >
            No tracks found
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredTracks.map((track) => (
              <div
                key={track.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  borderRadius: 8,
                  padding: 16,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => handlePlay(track.id)}
                  style={{
                    width: 40,
                    height: 40,
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
                    style={{ fontSize: 20 }}
                  >
                    {playingTrack === track.id ? "pause" : "play_arrow"}
                  </span>
                </button>

                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#e5e2e1",
                      marginBottom: 4,
                    }}
                  >
                    {track.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.5)",
                      display: "flex",
                      gap: 12,
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
                        gap: 6,
                        marginTop: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {track.mood.map((mood) => (
                        <span
                          key={mood}
                          style={{
                            padding: "2px 8px",
                            background: "rgba(var(--v2-accent-rgb), 0.15)",
                            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                            borderRadius: 4,
                            fontSize: 9,
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
                  onClick={() => handleDelete(track.id)}
                  style={{
                    padding: "8px 12px",
                    background: "rgba(255,80,80,0.15)",
                    border: "1px solid rgba(255,80,80,0.3)",
                    borderRadius: 6,
                    color: "#ff8080",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
