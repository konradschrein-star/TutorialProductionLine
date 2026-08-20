"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReviewStatus = "pending" | "approved" | "edited" | "flagged" | "skipped";

interface Clip {
  id: string;
  library_id: string;
  source_video_id: string;
  source_video_cdn_url: string | null;
  start_ms: number;
  end_ms: number;
  cdn_url: string | null;
  thumbnail_url: string | null;
  review_status: ReviewStatus;
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

interface Props {
  libraryId: string;
  initialSourceVideoId?: string;
  initialStatus?: string;
  initialLabelingStep?: string;
}

// ── Badge styles ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<
  ReviewStatus,
  { bg: string; text: string; border: string }
> = {
  pending: {
    bg: "rgba(255,200,0,0.15)",
    text: "#ffc800",
    border: "rgba(255,200,0,0.3)",
  },
  approved: {
    bg: "rgba(0,220,130,0.15)",
    text: "#00dc82",
    border: "rgba(0,220,130,0.3)",
  },
  edited: {
    bg: "rgba(var(--v2-accent-rgb),0.15)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  flagged: {
    bg: "rgba(255,140,0,0.15)",
    text: "#ff8c00",
    border: "rgba(255,140,0,0.3)",
  },
  skipped: {
    bg: "rgba(255,255,255,0.06)",
    text: "rgba(205,195,215,0.4)",
    border: "rgba(255,255,255,0.1)",
  },
};

const LABELING_STEP_COLOR: Record<string, string> = {
  vlm: "#60a5fa",
  whisper: "#34d399",
  face: "#a78bfa",
  audio: "#f97316",
  done: "#00dc82",
  pending: "rgba(205,195,215,0.3)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getClipVideoUrl(clip: Clip): string | null {
  if (clip.cdn_url) return clip.cdn_url;
  if (clip.source_video_cdn_url) {
    const startS = (clip.start_ms / 1000).toFixed(3);
    const endS = (clip.end_ms / 1000).toFixed(3);
    return `${clip.source_video_cdn_url}#t=${startS},${endS}`;
  }
  return null;
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
  const durationMs = clip.end_ms - clip.start_ms;
  const startS = clip.start_ms / 1000;
  const endS = clip.end_ms / 1000;
  const videoUrl = getClipVideoUrl(clip);
  const reviewStyle = STATUS_STYLE[clip.review_status] ?? STATUS_STYLE.pending;

  // ESC to close
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
          maxWidth: 800,
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, color: "var(--v2-accent)" }}
            >
              movie
            </span>
            <span style={{ color: "#e5e2e1", fontSize: 14, fontWeight: 700 }}>
              Clip Detail
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href={`/clip-library/${libraryId}/review?clip_id=${clip.id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textDecoration: "none",
                background: "rgba(var(--v2-accent-rgb),0.1)",
                color: "var(--v2-accent)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13 }}
              >
                rate_review
              </span>
              Open in Review
            </Link>
            <button
              onClick={onClose}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                fontSize: 11,
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
                style={{ fontSize: 18 }}
              >
                close
              </span>
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0 }}
        >
          {/* Left: video + text */}
          <div
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              borderRight: "1px solid rgba(var(--v2-accent-rgb),0.06)",
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
              {videoUrl ? (
                <video
                  src={videoUrl}
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
                    flexDirection: "column",
                    gap: 8,
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
                    No video source
                  </p>
                </div>
              )}
            </div>

            {/* Timing pills */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Start", value: `${startS.toFixed(2)}s` },
                { label: "End", value: `${endS.toFixed(2)}s` },
                { label: "Duration", value: formatDuration(durationMs) },
                ...(clip.shot_scale
                  ? [
                      {
                        label: "Shot",
                        value: clip.shot_scale.replace(/_/g, " "),
                      },
                    ]
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
                { label: "Used", value: `${clip.times_used}×` },
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

          {/* Right: metadata */}
          <div
            style={{
              padding: "20px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Status */}
            <div>
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
                Review Status
              </p>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  background: reviewStyle.bg,
                  color: reviewStyle.text,
                  border: `1px solid ${reviewStyle.border}`,
                }}
              >
                {clip.review_status}
              </span>
            </div>

            {/* Labeling step */}
            {clip.labeling_step && (
              <div>
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
                  Labeling Step
                </p>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: LABELING_STEP_COLOR[clip.labeling_step] ?? "#cdc3d7",
                    background: `${LABELING_STEP_COLOR[clip.labeling_step] ?? "#cdc3d7"}18`,
                    border: `1px solid ${LABELING_STEP_COLOR[clip.labeling_step] ?? "#cdc3d7"}30`,
                  }}
                >
                  {clip.labeling_step}
                </span>
              </div>
            )}

            {/* Clip ID */}
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 4px 0",
                }}
              >
                Clip ID
              </p>
              <p
                style={{
                  color: "rgba(205,195,215,0.4)",
                  fontSize: 10,
                  fontFamily: "monospace",
                  margin: 0,
                  wordBreak: "break-all",
                }}
              >
                {clip.id}
              </p>
            </div>

            {/* Tags */}
            {[
              {
                key: "characters",
                tags: clip.tags_characters,
                color: "#a78bfa",
              },
              { key: "mood", tags: clip.tags_mood, color: "#34d399" },
              { key: "location", tags: clip.tags_location, color: "#60a5fa" },
              { key: "action", tags: clip.tags_action, color: "#f97316" },
            ]
              .filter((g) => g.tags.length > 0)
              .map(({ key, tags, color }) => (
                <div key={key}>
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
                    {key}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: `${color}18`,
                          color,
                          border: `1px solid ${color}30`,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Clip Card ─────────────────────────────────────────────────────────────────

function ClipCard({ clip, onClick }: { clip: Clip; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const durationMs = clip.end_ms - clip.start_ms;
  const videoUrl = getClipVideoUrl(clip);
  const reviewStyle = STATUS_STYLE[clip.review_status] ?? STATUS_STYLE.pending;
  const labelColor = clip.labeling_step
    ? (LABELING_STEP_COLOR[clip.labeling_step] ?? "#cdc3d7")
    : "rgba(205,195,215,0.3)";

  useEffect(() => {
    if (!videoRef.current) return;
    if (hovered) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered]);

  return (
    <div
      onClick={onClick}
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
        {clip.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbnail_url}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: hovered ? "none" : "block",
            }}
          />
        ) : (
          !hovered && (
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
                    color: "rgba(205,195,215,0.25)",
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
          )
        )}

        {/* Video on hover */}
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
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

        {/* Duration badge */}
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            background: "rgba(0,0,0,0.7)",
            color: "#e5e2e1",
          }}
        >
          {formatDuration(durationMs)}
        </span>

        {/* Review status badge */}
        <span
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            background: reviewStyle.bg,
            color: reviewStyle.text,
            border: `1px solid ${reviewStyle.border}`,
            backdropFilter: "blur(4px)",
          }}
        >
          {clip.review_status}
        </span>

        {/* Labeling step badge */}
        {clip.labeling_step && (
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              background: `${labelColor}18`,
              color: labelColor,
              border: `1px solid ${labelColor}30`,
              backdropFilter: "blur(4px)",
            }}
          >
            {clip.labeling_step}
          </span>
        )}
      </div>

      {/* Card footer */}
      <div style={{ padding: "8px 10px" }}>
        {clip.ai_description ? (
          <p
            style={{
              color: hovered ? "#cdc3d7" : "rgba(205,195,215,0.55)",
              fontSize: 11,
              lineHeight: 1.4,
              margin: 0,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              transition: "color 0.15s",
            }}
          >
            {clip.ai_description}
          </p>
        ) : (
          <p
            style={{
              color: "rgba(205,195,215,0.25)",
              fontSize: 11,
              margin: 0,
              fontStyle: "italic",
            }}
          >
            No description
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClipGalleryClient({
  libraryId,
  initialSourceVideoId,
  initialStatus,
  initialLabelingStep,
}: Props) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState(initialStatus ?? "");
  const [labelingStepFilter, setLabelingStepFilter] = useState(
    initialLabelingStep ?? "",
  );
  const [sourceVideoIdFilter, setSourceVideoIdFilter] = useState(
    initialSourceVideoId ?? "",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy] = useState("created_at");
  const LIMIT = 40;

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (labelingStepFilter) params.set("labeling_step", labelingStepFilter);
      if (sourceVideoIdFilter)
        params.set("source_video_id", sourceVideoIdFilter);
      params.set("page", String(page));
      params.set("limit", String(LIMIT));
      // q param for text search (added to clips API)
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(
        `/api/clip-library/${libraryId}/clips?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setClips(data.clips ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clips");
    } finally {
      setLoading(false);
    }
  }, [
    libraryId,
    statusFilter,
    labelingStepFilter,
    sourceVideoIdFilter,
    searchQuery,
    page,
  ]);

  useEffect(() => {
    void fetchClips();
  }, [fetchClips]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, labelingStepFilter, sourceVideoIdFilter, searchQuery]);

  const totalPages = Math.ceil(total / LIMIT);

  const filterSelectStyle = {
    padding: "6px 10px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
    color: "#cdc3d7",
    cursor: "pointer",
    outline: "none",
    minWidth: 120,
  } as React.CSSProperties;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
          borderRadius: 10,
        }}
      >
        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: "1 1 180px",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color: "rgba(205,195,215,0.4)" }}
          >
            search
          </span>
          <input
            type="text"
            placeholder="Search descriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e5e2e1",
              fontSize: 12,
              width: "100%",
            }}
          />
        </div>

        {/* Divider */}
        <div
          style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }}
        />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="edited">Edited</option>
          <option value="flagged">Flagged</option>
          <option value="skipped">Skipped</option>
        </select>

        {/* Labeling step filter */}
        <select
          value={labelingStepFilter}
          onChange={(e) => setLabelingStepFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">All Steps</option>
          <option value="vlm">VLM</option>
          <option value="whisper">Whisper</option>
          <option value="face">Face</option>
          <option value="audio">Audio</option>
          <option value="done">Done</option>
        </select>

        {/* Clear filters */}
        {(statusFilter ||
          labelingStepFilter ||
          sourceVideoIdFilter ||
          searchQuery) && (
          <button
            onClick={() => {
              setStatusFilter("");
              setLabelingStepFilter("");
              setSourceVideoIdFilter("");
              setSearchQuery("");
            }}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(205,195,215,0.5)",
            }}
          >
            Clear
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Count */}
        <span
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.4)",
            fontWeight: 600,
          }}
        >
          {total.toLocaleString()} clips
        </span>

        {/* Review All link */}
        <Link
          href={`/clip-library/${libraryId}/review${statusFilter ? `?status=${statusFilter}` : ""}${labelingStepFilter ? `&labeling_step=${labelingStepFilter}` : ""}${sourceVideoIdFilter ? `&source_video_id=${sourceVideoIdFilter}` : ""}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            background: "var(--v2-accent)",
            color: "#000",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
            rate_review
          </span>
          Review All
        </Link>
      </div>

      {/* Source video filter chip */}
      {sourceVideoIdFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: "rgba(var(--v2-accent-rgb),0.08)",
              color: "var(--v2-accent)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 13 }}
            >
              filter_alt
            </span>
            Filtered by source video
            <button
              onClick={() => setSourceVideoIdFilter("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13 }}
              >
                close
              </span>
            </button>
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 200,
            gap: 10,
            color: "rgba(205,195,215,0.4)",
            fontSize: 13,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, animation: "spin 1.5s linear infinite" }}
          >
            progress_activity
          </span>
          Loading clips...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.25)",
            borderRadius: 10,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color: "#ff5050" }}
          >
            error
          </span>
          <span style={{ color: "#ff5050", fontSize: 13 }}>{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && clips.length === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 240,
            gap: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 40, color: "rgba(var(--v2-accent-rgb),0.3)" }}
          >
            grid_off
          </span>
          <p style={{ color: "#cdc3d7", fontSize: 13, margin: 0 }}>
            No clips match the current filters
          </p>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}
          >
            Try broader filters or check the Ingest page
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && clips.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              onClick={() => setSelectedClip(clip)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            paddingTop: 8,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: page === 1 ? "not-allowed" : "pointer",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: page === 1 ? "rgba(205,195,215,0.2)" : "#cdc3d7",
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 11, color: "rgba(205,195,215,0.4)" }}>
            Page {page} of {totalPages} &middot; {total.toLocaleString()} clips
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: page === totalPages ? "not-allowed" : "pointer",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: page === totalPages ? "rgba(205,195,215,0.2)" : "#cdc3d7",
            }}
          >
            Next →
          </button>
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
