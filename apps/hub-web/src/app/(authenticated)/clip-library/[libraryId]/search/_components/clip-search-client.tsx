"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Clip {
  id: string;
  library_id: string;
  source_video_id: string;
  start_ms: number;
  end_ms: number;
  cdn_url: string | null;
  thumbnail_url: string | null;
  review_status: string;
  labeling_step: string | null;
  ai_description: string | null;
  shot_scale: string | null;
  dominant_mood: string | null;
  audio_class: string | null;
  tags_characters: string[];
  tags_mood: string[];
  tags_location: string[];
  tags_action: string[];
  transcript: string | null;
  times_used: number;
}

interface SearchResult {
  clip: Clip;
  rrf_score: number;
  dense_rank: number | null;
  sparse_rank: number | null;
  text_rank: number | null;
  match_reason: string;
}

interface Props {
  libraryId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function scoreColor(score: number): string {
  if (score >= 0.1) return "#00dc82";
  if (score >= 0.05) return "#ffc800";
  return "#ff8c00";
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: () => void;
}) {
  const { clip, rrf_score, match_reason } = result;
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const durationMs = clip.end_ms - clip.start_ms;

  useEffect(() => {
    if (!videoRef.current) return;
    if (hovered && clip.cdn_url) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered, clip.cdn_url]);

  const channels: string[] = [];
  if (result.dense_rank !== null) channels.push("dense");
  if (result.sparse_rank !== null) channels.push("sparse");
  if (result.text_rank !== null) channels.push("text");

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 10,
        overflow: "hidden",
        background: "rgba(255,255,255,0.03)",
        border: hovered
          ? "1px solid rgba(var(--v2-accent-rgb),0.35)"
          : "1px solid rgba(var(--v2-accent-rgb),0.1)",
        cursor: "pointer",
        transition: "border-color 0.15s",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thumbnail / video */}
      <div
        style={{
          position: "relative",
          aspectRatio: "16/9",
          background: "#000",
          overflow: "hidden",
        }}
      >
        {clip.thumbnail_url && !hovered ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbnail_url}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : !hovered ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {clip.ai_description ? (
              <p
                style={{
                  color: "rgba(205,195,215,0.2)",
                  fontSize: 10,
                  lineHeight: 1.4,
                  padding: "0 10px",
                  textAlign: "center",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {clip.ai_description}
              </p>
            ) : (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 28, color: "rgba(205,195,215,0.15)" }}
              >
                movie
              </span>
            )}
          </div>
        ) : null}

        {clip.cdn_url && (
          <video
            ref={videoRef}
            src={clip.cdn_url}
            muted
            loop
            playsInline
            preload="none"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: hovered ? "block" : "none",
            }}
          />
        )}

        {/* Duration */}
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            background: "rgba(0,0,0,0.75)",
            color: "#e5e2e1",
          }}
        >
          {formatDuration(durationMs)}
        </span>

        {/* RRF score badge */}
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            padding: "2px 7px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            background: "rgba(0,0,0,0.7)",
            color: scoreColor(rrf_score),
            backdropFilter: "blur(4px)",
          }}
        >
          {rrf_score.toFixed(4)}
        </span>

        {/* Channel badges */}
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            gap: 3,
          }}
        >
          {channels.map((ch) => (
            <span
              key={ch}
              style={{
                padding: "2px 5px",
                borderRadius: 3,
                fontSize: 8,
                fontWeight: 700,
                textTransform: "uppercase",
                background: "rgba(0,0,0,0.65)",
                color:
                  ch === "dense"
                    ? "#a78bfa"
                    : ch === "sparse"
                      ? "#60a5fa"
                      : "#34d399",
                backdropFilter: "blur(4px)",
              }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "8px 10px" }}>
        {clip.ai_description ? (
          <p
            style={{
              color: hovered ? "#cdc3d7" : "rgba(205,195,215,0.55)",
              fontSize: 11,
              lineHeight: 1.4,
              margin: "0 0 4px 0",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              transition: "color 0.15s",
            }}
          >
            {clip.ai_description}
          </p>
        ) : null}
        {match_reason && (
          <p
            style={{
              color: "rgba(205,195,215,0.3)",
              fontSize: 9,
              margin: 0,
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {match_reason}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Clip Detail Modal ─────────────────────────────────────────────────────────

function ClipDetailModal({
  clip,
  libraryId,
  onClose,
}: {
  clip: Clip;
  libraryId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#0e0e14",
          border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 17, color: "var(--v2-accent)" }}
            >
              movie
            </span>
            <span style={{ color: "#e5e2e1", fontSize: 13, fontWeight: 700 }}>
              Clip Detail
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Link
              href={`/clip-library/${libraryId}/review?clip_id=${clip.id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                textDecoration: "none",
                background: "rgba(var(--v2-accent-rgb),0.1)",
                color: "var(--v2-accent)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Open in Review
            </Link>
            <button
              onClick={onClose}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                cursor: "pointer",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(205,195,215,0.6)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 17 }}
              >
                close
              </span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Video */}
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              background: "#000",
              aspectRatio: "16/9",
            }}
          >
            {clip.cdn_url ? (
              <video
                src={clip.cdn_url}
                controls
                autoPlay
                loop
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  flexDirection: "column",
                  minHeight: 180,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 36, color: "rgba(205,195,215,0.2)" }}
                >
                  videocam_off
                </span>
                <p
                  style={{
                    color: "rgba(205,195,215,0.35)",
                    fontSize: 12,
                    margin: 0,
                  }}
                >
                  No CDN URL
                </p>
              </div>
            )}
          </div>

          {/* Pills */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              {
                label: "Duration",
                value: formatDuration(clip.end_ms - clip.start_ms),
              },
              ...(clip.shot_scale
                ? [{ label: "Shot", value: clip.shot_scale.replace(/_/g, " ") }]
                : []),
              ...(clip.audio_class
                ? [
                    {
                      label: "Audio",
                      value: clip.audio_class.replace(/_/g, " "),
                    },
                  ]
                : []),
              ...(clip.dominant_mood
                ? [{ label: "Mood", value: clip.dominant_mood }]
                : []),
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                }}
              >
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "rgba(205,195,215,0.35)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 2px 0",
                  }}
                >
                  {label}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    margin: 0,
                  }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* AI description */}
          {clip.ai_description && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 6px 0",
                }}
              >
                AI Description
              </p>
              <p
                style={{
                  color: "#cdc3d7",
                  fontSize: 13,
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                {clip.ai_description}
              </p>
            </div>
          )}

          {/* Transcript */}
          {clip.transcript && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 6px 0",
                }}
              >
                Transcript
              </p>
              <p
                style={{
                  color: "#cdc3d7",
                  fontSize: 13,
                  lineHeight: 1.6,
                  margin: 0,
                  fontStyle: "italic",
                }}
              >
                &quot;{clip.transcript}&quot;
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClipSearchClient({ libraryId }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [queryMode, setQueryMode] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filters
  const [shotScales, setShotScales] = useState<string[]>([]);
  const [avoidAudio, setAvoidAudio] = useState<string[]>([]);
  const [characterFilter, setCharacterFilter] = useState("");
  const [minDurationS, setMinDurationS] = useState("");
  const [maxDurationS, setMaxDurationS] = useState("");

  const SHOT_SCALES = [
    "extreme_close",
    "close",
    "medium",
    "wide",
    "extreme_wide",
  ];
  const AUDIO_CLASSES = [
    "dialogue",
    "music_only",
    "speech_over_music",
    "action_sfx",
    "ambient",
    "silence",
  ];

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const body: Record<string, unknown> = { query };
      const filters: Record<string, unknown> = {};
      if (shotScales.length > 0) filters.shot_scale_preference = shotScales;
      if (avoidAudio.length > 0) filters.avoid_audio_classes = avoidAudio;
      if (characterFilter.trim())
        filters.character_filter = [characterFilter.trim()];
      if (minDurationS)
        filters.min_duration_ms = parseFloat(minDurationS) * 1000;
      if (maxDurationS)
        filters.max_duration_ms = parseFloat(maxDurationS) * 1000;
      if (Object.keys(filters).length > 0) body.filters = filters;

      const res = await fetch(`/api/clip-library/${libraryId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResults(data.results ?? []);
      setQueryMode(data.query_mode ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleShotScale(scale: string) {
    setShotScales((prev) =>
      prev.includes(scale) ? prev.filter((s) => s !== scale) : [...prev, scale],
    );
  }

  function toggleAvoidAudio(cls: string) {
    setAvoidAudio((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls],
    );
  }

  const filterSelectStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
    background: "rgba(255,255,255,0.04)",
    color: "#cdc3d7",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Search box */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "14px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
          borderRadius: 10,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 22,
            color: "rgba(205,195,215,0.4)",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          search
        </span>
        <input
          type="text"
          placeholder="Describe the clip you're looking for... (semantic + text hybrid)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSearch();
          }}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e5e2e1",
            fontSize: 14,
            fontWeight: 500,
          }}
          autoFocus
        />
        <button
          onClick={() => void handleSearch()}
          disabled={!query.trim() || loading}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: !query.trim() || loading ? "not-allowed" : "pointer",
            background:
              !query.trim() || loading
                ? "rgba(var(--v2-accent-rgb),0.4)"
                : "var(--v2-accent)",
            color: "#000",
            border: "none",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {loading ? (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, animation: "spin 1.5s linear infinite" }}
            >
              progress_activity
            </span>
          ) : (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              search
            </span>
          )}
          {loading ? "Searching..." : "Search"}
        </button>

        <button
          onClick={() => setFiltersOpen((v) => !v)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            background: filtersOpen
              ? "rgba(var(--v2-accent-rgb),0.1)"
              : "rgba(255,255,255,0.04)",
            color: filtersOpen ? "var(--v2-accent)" : "rgba(205,195,215,0.6)",
            border: filtersOpen
              ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
              : "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            tune
          </span>
          Filters
        </button>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <div
          style={{
            padding: "16px 20px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Shot scale */}
          <div>
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 8px 0",
              }}
            >
              Preferred Shot Scale (soft boost)
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SHOT_SCALES.map((scale) => (
                <button
                  key={scale}
                  onClick={() => toggleShotScale(scale)}
                  style={{
                    ...filterSelectStyle,
                    background: shotScales.includes(scale)
                      ? "rgba(var(--v2-accent-rgb),0.12)"
                      : "rgba(255,255,255,0.04)",
                    color: shotScales.includes(scale)
                      ? "var(--v2-accent)"
                      : "#cdc3d7",
                    border: shotScales.includes(scale)
                      ? "1px solid rgba(var(--v2-accent-rgb),0.35)"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {scale.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Avoid audio classes */}
          <div>
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 8px 0",
              }}
            >
              Exclude Audio Classes
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {AUDIO_CLASSES.map((cls) => (
                <button
                  key={cls}
                  onClick={() => toggleAvoidAudio(cls)}
                  style={{
                    ...filterSelectStyle,
                    background: avoidAudio.includes(cls)
                      ? "rgba(255,80,80,0.1)"
                      : "rgba(255,255,255,0.04)",
                    color: avoidAudio.includes(cls) ? "#ff5050" : "#cdc3d7",
                    border: avoidAudio.includes(cls)
                      ? "1px solid rgba(255,80,80,0.3)"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {cls.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Character + duration */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                flex: "1 1 160px",
              }}
            >
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Character Filter
              </label>
              <input
                type="text"
                placeholder="e.g. Host"
                value={characterFilter}
                onChange={(e) => setCharacterFilter(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Min Duration (s)
              </label>
              <input
                type="number"
                placeholder="0"
                value={minDurationS}
                onChange={(e) => setMinDurationS(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                  width: 80,
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Max Duration (s)
              </label>
              <input
                type="number"
                placeholder="600"
                value={maxDurationS}
                onChange={(e) => setMaxDurationS(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                  width: 80,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.25)",
            borderRadius: 10,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 17, color: "#ff5050" }}
          >
            error
          </span>
          <span style={{ color: "#ff5050", fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Results */}
      {hasSearched && !loading && !error && (
        <>
          {/* Results header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}>
              {results.length} results
            </span>
            {queryMode && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  background:
                    queryMode === "hybrid"
                      ? "rgba(var(--v2-accent-rgb),0.1)"
                      : "rgba(255,200,0,0.1)",
                  color:
                    queryMode === "hybrid" ? "var(--v2-accent)" : "#ffc800",
                  border:
                    queryMode === "hybrid"
                      ? "1px solid rgba(var(--v2-accent-rgb),0.25)"
                      : "1px solid rgba(255,200,0,0.25)",
                }}
              >
                {queryMode === "hybrid"
                  ? "Hybrid (dense + sparse + text)"
                  : "Text fallback"}
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 200,
                gap: 12,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 40,
                  color: "rgba(var(--v2-accent-rgb),0.3)",
                }}
              >
                search_off
              </span>
              <p style={{ color: "#cdc3d7", fontSize: 13, margin: 0 }}>
                No clips match — try broader filters
              </p>
              <p
                style={{
                  color: "rgba(205,195,215,0.4)",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                Remove shot scale / audio class filters or use different search
                terms
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              {results.map((result) => (
                <ResultCard
                  key={result.clip.id}
                  result={result}
                  onSelect={() => setSelectedClip(result.clip)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Initial empty state */}
      {!hasSearched && !loading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 280,
            gap: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 48, color: "rgba(var(--v2-accent-rgb),0.3)" }}
          >
            manage_search
          </span>
          <p style={{ color: "#cdc3d7", fontSize: 14, margin: 0 }}>
            Enter a description to search the clip library
          </p>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}
          >
            Uses dense embeddings + sparse vectors + full-text search (RRF)
          </p>
        </div>
      )}

      {/* Clip Detail Modal */}
      {selectedClip && (
        <ClipDetailModal
          clip={selectedClip}
          libraryId={libraryId}
          onClose={() => setSelectedClip(null)}
        />
      )}
    </div>
  );
}
