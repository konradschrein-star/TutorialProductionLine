"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────────────

type ReviewStatus = "pending" | "approved" | "edited" | "flagged" | "skipped";

interface Clip {
  id: string;
  library_id: string;
  source_video_id: string;
  start_ms: number;
  end_ms: number;
  cdn_url: string | null;
  thumbnail_url: string | null;
  review_status: ReviewStatus;
  labeling_step: string | null;
  ai_description: string | null;
  shot_scale: string | null;
  clip_type: string | null;
  dominant_mood: string | null;
  audio_class: string | null;
  tags_characters: string[];
  tags_mood: string[];
  tags_location: string[];
  tags_action: string[];
  tags_custom: string[];
  transcript: string | null;
  width: number | null;
  height: number | null;
  ai_confidence: number | null;
  // Visual analysis
  motion_level: string | null;
  camera_movement: string | null;
  lighting_style: string | null;
  color_temperature: string | null;
  face_count: number | null;
  has_text_overlay: boolean | null;
  dialogue_present: boolean | null;
  source_episode: string | null;
  scene_context: string | null;
  keywords: string[];
  // Human review
  quality_score: number | null;
  manual_notes: string | null;
  is_usable: boolean | null;
  // Drizzle returns Date for timestamp columns; UI stringifies before render.
  reviewed_at: string | Date | null;
  // Global library: ordinal + external_ref + dedup + aesthetic vectors
  clip_index?: number;
  external_ref?: string | null;
  duplicate_of_id?: string | null;
  phash?: bigint | null;
  motion_score?: number | null;
  palette_dominant_hex?: string[] | null;
}

interface Props {
  libraryId: string;
  initialClips: Clip[];
  sourceVideoCdnMap: Record<string, string | null>;
  tagVocabulary: Record<string, string[]>;
  total: number;
  page: number;
  totalPages: number;
  currentFilters: {
    status: string;
    labelingStep: string;
    sourceVideoId?: string;
  };
}

// ── Status badge colors ───────────────────────────────────────────────────────

const STATUS_STYLE: Record<
  ReviewStatus,
  { bg: string; text: string; border: string }
> = {
  pending: {
    bg: "rgba(255,200,0,0.12)",
    text: "#ffc800",
    border: "rgba(255,200,0,0.3)",
  },
  approved: {
    bg: "rgba(0,220,130,0.12)",
    text: "#00dc82",
    border: "rgba(0,220,130,0.3)",
  },
  edited: {
    bg: "rgba(var(--v2-accent-rgb),0.12)",
    text: "var(--v2-accent)",
    border: "rgba(var(--v2-accent-rgb),0.3)",
  },
  flagged: {
    bg: "rgba(255,140,0,0.12)",
    text: "#ff8c00",
    border: "rgba(255,140,0,0.3)",
  },
  skipped: {
    bg: "rgba(255,255,255,0.06)",
    text: "rgba(205,195,215,0.4)",
    border: "rgba(255,255,255,0.08)",
  },
};

// ── Main component ────────────────────────────────────────────────────────────

export function ClipReviewClient({
  libraryId,
  initialClips,
  sourceVideoCdnMap,
  tagVocabulary,
  total,
  page,
  totalPages,
  currentFilters,
}: Props) {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [notification, setNotification] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Draft tag state for editing
  const [draftTags, setDraftTags] = useState<{
    characters: string[];
    mood: string[];
    location: string[];
    action: string[];
  }>({ characters: [], mood: [], location: [], action: [] });
  const [draftDescription, setDraftDescription] = useState("");
  const [draftQualityScore, setDraftQualityScore] = useState<number | null>(
    null,
  );
  const [draftManualNotes, setDraftManualNotes] = useState("");
  const [draftIsUsable, setDraftIsUsable] = useState<boolean | null>(null);
  const [draftSourceEpisode, setDraftSourceEpisode] = useState("");
  const [draftSceneContext, setDraftSceneContext] = useState("");
  const [draftKeywords, setDraftKeywords] = useState("");
  const [retagging, setRetagging] = useState(false);

  const currentClip = clips[currentIndex];

  // Reset edit mode when clip changes
  useEffect(() => {
    setEditMode(false);
  }, [currentIndex]);

  // Keyboard handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          void handleAction("approved");
          break;
        case "e":
          e.preventDefault();
          openEditMode();
          break;
        case "f":
          e.preventDefault();
          void handleAction("flagged");
          break;
        case "s":
          e.preventDefault();
          void handleAction("skipped");
          break;
        case "arrowleft":
          e.preventDefault();
          setCurrentIndex((i) => Math.max(0, i - 1));
          break;
        case "arrowright":
          e.preventDefault();
          setCurrentIndex((i) => Math.min(clips.length - 1, i + 1));
          break;
        case "escape":
          setEditMode(false);
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clips.length, currentClip, editMode]);

  function showNotification(text: string, type: "success" | "error") {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 2500);
  }

  async function patchClip(
    clipId: string,
    payload: Record<string, unknown>,
  ): Promise<Clip | null> {
    const res = await fetch(`/api/clip-library/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.clip as Clip;
  }

  async function handleAction(status: ReviewStatus) {
    if (!currentClip || saving) return;
    setSaving(true);
    try {
      const updated = await patchClip(currentClip.id, {
        review_status: status,
      });
      if (updated) {
        setClips((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c)),
        );
      }
      showNotification(
        `Clip ${status === "approved" ? "approved" : status === "flagged" ? "flagged" : "skipped"}`,
        "success",
      );
      // Auto-advance to next clip
      setCurrentIndex((i) => Math.min(clips.length - 1, i + 1));
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Save failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function openEditMode() {
    if (!currentClip) return;
    setDraftTags({
      characters: [...currentClip.tags_characters],
      mood: [...currentClip.tags_mood],
      location: [...currentClip.tags_location],
      action: [...currentClip.tags_action],
    });
    setDraftDescription(currentClip.ai_description ?? "");
    setDraftQualityScore(currentClip.quality_score ?? null);
    setDraftManualNotes(currentClip.manual_notes ?? "");
    setDraftIsUsable(currentClip.is_usable ?? null);
    setDraftSourceEpisode(currentClip.source_episode ?? "");
    setDraftSceneContext(currentClip.scene_context ?? "");
    setDraftKeywords((currentClip.keywords ?? []).join(", "));
    setEditMode(true);
  }

  async function handleAiRetag() {
    if (!currentClip || retagging) return;
    setRetagging(true);
    try {
      const res = await fetch(
        `/api/clip-library/clips/${currentClip.id}/retag`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      showNotification("AI retag queued — refresh in a moment", "success");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Retag failed",
        "error",
      );
    } finally {
      setRetagging(false);
    }
  }

  async function handleSaveEdit() {
    if (!currentClip || saving) return;
    setSaving(true);
    try {
      const keywords = draftKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const updated = await patchClip(currentClip.id, {
        review_status: "edited",
        tags_characters: draftTags.characters,
        tags_mood: draftTags.mood,
        tags_location: draftTags.location,
        tags_action: draftTags.action,
        ai_description: draftDescription || null,
        quality_score: draftQualityScore,
        manual_notes: draftManualNotes || null,
        is_usable: draftIsUsable,
        source_episode: draftSourceEpisode || null,
        scene_context: draftSceneContext || null,
        keywords,
      });
      if (updated) {
        setClips((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c)),
        );
      }
      setEditMode(false);
      showNotification("Tags saved", "success");
      setCurrentIndex((i) => Math.min(clips.length - 1, i + 1));
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Save failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleDraftTag(group: keyof typeof draftTags, value: string) {
    setDraftTags((prev) => {
      const current = prev[group];
      return {
        ...prev,
        [group]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  }

  async function handleBulkApprove() {
    if (bulkApproving) return;
    setBulkApproving(true);
    try {
      await Promise.all(
        clips.map((clip) => patchClip(clip.id, { review_status: "approved" })),
      );
      setClips((prev) =>
        prev.map((c) => ({ ...c, review_status: "approved" as ReviewStatus })),
      );
      showNotification(`Approved ${clips.length} clips`, "success");
    } catch (err) {
      showNotification(
        err instanceof Error ? err.message : "Bulk approve failed",
        "error",
      );
    } finally {
      setBulkApproving(false);
    }
  }

  if (!currentClip) return null;

  // Build video src
  const startS = currentClip.start_ms / 1000;
  const endS = currentClip.end_ms / 1000;
  const sourceVideoCdn = sourceVideoCdnMap[currentClip.source_video_id];
  const videoSrc = currentClip.cdn_url
    ? currentClip.cdn_url
    : sourceVideoCdn
      ? `${sourceVideoCdn}#t=${startS.toFixed(3)},${endS.toFixed(3)}`
      : null;

  const reviewStyle =
    STATUS_STYLE[currentClip.review_status] ?? STATUS_STYLE.pending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Notification toast */}
      {notification && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background:
              notification.type === "success"
                ? "rgba(0,220,130,0.15)"
                : "rgba(255,80,80,0.15)",
            color: notification.type === "success" ? "#00dc82" : "#ff5050",
            border: `1px solid ${notification.type === "success" ? "rgba(0,220,130,0.3)" : "rgba(255,80,80,0.3)"}`,
            backdropFilter: "blur(8px)",
            pointerEvents: "none",
          }}
        >
          {notification.text}
        </div>
      )}

      {/* Top toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        {/* Clip counter + nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            style={navBtnStyle(currentIndex === 0)}
            aria-label="Previous clip"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              chevron_left
            </span>
          </button>

          <span
            style={{
              fontSize: 12,
              color: "#cdc3d7",
              fontWeight: 600,
              minWidth: 80,
              textAlign: "center",
            }}
          >
            {currentIndex + 1} / {clips.length}
            {total > clips.length && (
              <span style={{ color: "rgba(205,195,215,0.4)", fontSize: 10 }}>
                {" "}
                (of {total.toLocaleString()})
              </span>
            )}
          </span>

          <button
            onClick={() =>
              setCurrentIndex((i) => Math.min(clips.length - 1, i + 1))
            }
            disabled={currentIndex === clips.length - 1}
            style={navBtnStyle(currentIndex === clips.length - 1)}
            aria-label="Next clip"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              chevron_right
            </span>
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          {/* Approve All Visible */}
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving || saving}
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              cursor: bulkApproving ? "not-allowed" : "pointer",
              border: "1px solid rgba(0,220,130,0.3)",
              background: "rgba(0,220,130,0.08)",
              color: "#00dc82",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: bulkApproving ? 0.6 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15 }}
            >
              {bulkApproving ? "hourglass_empty" : "done_all"}
            </span>
            {bulkApproving ? "Approving..." : `Approve All (${clips.length})`}
          </button>

          {/* Individual action buttons */}
          <ActionButton
            label="Approve"
            icon="check_circle"
            color="#00dc82"
            borderColor="rgba(0,220,130,0.3)"
            bg="rgba(0,220,130,0.08)"
            onClick={() => handleAction("approved")}
            disabled={saving}
            kbd="A"
          />
          <ActionButton
            label="Edit Tags"
            icon="edit"
            color="var(--v2-accent)"
            borderColor="rgba(var(--v2-accent-rgb),0.3)"
            bg="rgba(var(--v2-accent-rgb),0.08)"
            onClick={openEditMode}
            disabled={saving}
            kbd="E"
          />
          <ActionButton
            label="Flag"
            icon="flag"
            color="#ff8c00"
            borderColor="rgba(255,140,0,0.3)"
            bg="rgba(255,140,0,0.08)"
            onClick={() => handleAction("flagged")}
            disabled={saving}
            kbd="F"
          />
          <ActionButton
            label="Skip"
            icon="skip_next"
            color="rgba(205,195,215,0.5)"
            borderColor="rgba(255,255,255,0.12)"
            bg="rgba(255,255,255,0.04)"
            onClick={() => handleAction("skipped")}
            disabled={saving}
            kbd="S"
          />
        </div>
      </div>

      {/* Main content grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left: video player */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Video */}
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              background: "#000",
              border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
              aspectRatio:
                currentClip.width && currentClip.height
                  ? `${currentClip.width}/${currentClip.height}`
                  : "16/9",
              position: "relative",
            }}
          >
            {videoSrc ? (
              <video
                ref={videoRef}
                key={currentClip.id}
                src={videoSrc}
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
                  minHeight: 240,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 40, color: "rgba(205,195,215,0.2)" }}
                >
                  videocam_off
                </span>
                <p
                  style={{
                    color: "rgba(205,195,215,0.4)",
                    fontSize: 12,
                    margin: 0,
                  }}
                >
                  No CDN URL available
                </p>
              </div>
            )}
          </div>

          {/* Clip timing */}
          <div style={{ display: "flex", gap: 12 }}>
            <MetaPill
              label="Start"
              value={formatTime(currentClip.start_ms)}
              title="Seek to start"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = startS;
              }}
            />
            <MetaPill
              label="End"
              value={formatTime(currentClip.end_ms)}
              title="Seek to end"
              onClick={() => {
                if (videoRef.current)
                  videoRef.current.currentTime = Math.max(startS, endS - 1.5);
              }}
            />
            <MetaPill
              label="Duration"
              value={formatDuration(currentClip.end_ms - currentClip.start_ms)}
              title="Replay from start"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = startS;
                  void videoRef.current.play();
                }
              }}
            />
            {currentClip.shot_scale && (
              <MetaPill
                label="Shot"
                value={currentClip.shot_scale.replace(/_/g, " ")}
              />
            )}
            {currentClip.audio_class && (
              <MetaPill
                label="Audio"
                value={currentClip.audio_class.replace(/_/g, " ")}
              />
            )}
          </div>

          {/* AI description */}
          {currentClip.ai_description && (
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
                  color: "rgba(205,195,215,0.4)",
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
                {currentClip.ai_description}
              </p>
            </div>
          )}

          {/* Transcript */}
          {currentClip.transcript && (
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
                  color: "rgba(205,195,215,0.4)",
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
                &quot;{currentClip.transcript}&quot;
              </p>
            </div>
          )}
        </div>

        {/* Right: metadata + tags */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Status + clip ID */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Review Status
              </span>
              <span
                style={{
                  padding: "3px 8px",
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
                {currentClip.review_status}
              </span>
            </div>
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 3px 0",
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
                {currentClip.id}
              </p>
            </div>
            {currentClip.dominant_mood && (
              <div>
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(205,195,215,0.4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 3px 0",
                  }}
                >
                  Mood
                </p>
                <p
                  style={{
                    color: "#cdc3d7",
                    fontSize: 12,
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  {currentClip.dominant_mood}
                </p>
              </div>
            )}
            {/* Quality score */}
            {currentClip.quality_score !== null && (
              <div>
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(205,195,215,0.4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 4px 0",
                  }}
                >
                  Quality
                </p>
                <div style={{ display: "flex", gap: 3 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 14,
                        color:
                          n <= (currentClip.quality_score ?? 0)
                            ? "#ffc800"
                            : "rgba(255,255,255,0.1)",
                      }}
                    >
                      star
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* is_usable flag */}
            {currentClip.is_usable !== null && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: currentClip.is_usable
                    ? "rgba(0,220,130,0.1)"
                    : "rgba(255,80,80,0.1)",
                  border: `1px solid ${currentClip.is_usable ? "rgba(0,220,130,0.25)" : "rgba(255,80,80,0.25)"}`,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 13,
                    color: currentClip.is_usable ? "#00dc82" : "#ff5050",
                  }}
                >
                  {currentClip.is_usable ? "check_circle" : "cancel"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: currentClip.is_usable ? "#00dc82" : "#ff5050",
                  }}
                >
                  {currentClip.is_usable ? "Usable" : "Not Usable"}
                </span>
              </div>
            )}
          </div>

          {/* Visual analysis panel */}
          {(currentClip.motion_level ||
            currentClip.camera_movement ||
            currentClip.lighting_style ||
            currentClip.color_temperature ||
            currentClip.face_count !== null ||
            currentClip.has_text_overlay !== null ||
            currentClip.dialogue_present !== null ||
            currentClip.clip_type ||
            currentClip.source_episode) && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: 0,
                }}
              >
                Visual Analysis
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[
                  currentClip.clip_type && {
                    label: currentClip.clip_type.replace(/_/g, " "),
                    color: "#60a5fa",
                  },
                  currentClip.motion_level && {
                    label: `Motion: ${currentClip.motion_level}`,
                    color: "#f97316",
                  },
                  currentClip.camera_movement && {
                    label: `Cam: ${currentClip.camera_movement}`,
                    color: "#a78bfa",
                  },
                  currentClip.lighting_style && {
                    label: currentClip.lighting_style,
                    color: "#fbbf24",
                  },
                  currentClip.color_temperature && {
                    label: currentClip.color_temperature,
                    color: "#34d399",
                  },
                  currentClip.face_count !== null && {
                    label: `${currentClip.face_count} face${currentClip.face_count !== 1 ? "s" : ""}`,
                    color: "#e879f9",
                  },
                  currentClip.has_text_overlay === true && {
                    label: "Text overlay",
                    color: "#f87171",
                  },
                  currentClip.dialogue_present === true && {
                    label: "Dialogue",
                    color: "#38bdf8",
                  },
                  currentClip.source_episode && {
                    label: currentClip.source_episode,
                    color: "#94a3b8",
                  },
                ]
                  .filter(Boolean)
                  .map((item, i) => {
                    const { label, color } = item as {
                      label: string;
                      color: string;
                    };
                    return (
                      <span
                        key={i}
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          background: `${color}18`,
                          color,
                          border: `1px solid ${color}30`,
                        }}
                      >
                        {label}
                      </span>
                    );
                  })}
              </div>
              {currentClip.scene_context && (
                <p
                  style={{
                    color: "rgba(205,195,215,0.55)",
                    fontSize: 11,
                    lineHeight: 1.4,
                    margin: 0,
                    fontStyle: "italic",
                  }}
                >
                  {currentClip.scene_context}
                </p>
              )}
            </div>
          )}

          {/* Manual notes */}
          {currentClip.manual_notes && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,200,0,0.05)",
                border: "1px solid rgba(255,200,0,0.15)",
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255,200,0,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "0 0 4px 0",
                }}
              >
                Notes
              </p>
              <p
                style={{
                  color: "#cdc3d7",
                  fontSize: 12,
                  lineHeight: 1.4,
                  margin: 0,
                }}
              >
                {currentClip.manual_notes}
              </p>
            </div>
          )}

          {/* Keywords */}
          {(currentClip.keywords ?? []).length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.06)",
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
                Keywords
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(currentClip.keywords ?? []).map((kw) => (
                  <span
                    key={kw}
                    style={{
                      padding: "2px 7px",
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      background: "rgba(255,255,255,0.05)",
                      color: "rgba(205,195,215,0.5)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags panel */}
          {editMode ? (
            <TagEditor
              tagVocabulary={tagVocabulary}
              draftTags={draftTags}
              draftDescription={draftDescription}
              draftQualityScore={draftQualityScore}
              draftManualNotes={draftManualNotes}
              draftIsUsable={draftIsUsable}
              draftSourceEpisode={draftSourceEpisode}
              draftSceneContext={draftSceneContext}
              draftKeywords={draftKeywords}
              onToggle={toggleDraftTag}
              onDescriptionChange={setDraftDescription}
              onQualityScoreChange={setDraftQualityScore}
              onManualNotesChange={setDraftManualNotes}
              onIsUsableChange={setDraftIsUsable}
              onSourceEpisodeChange={setDraftSourceEpisode}
              onSceneContextChange={setDraftSceneContext}
              onKeywordsChange={setDraftKeywords}
              onSave={handleSaveEdit}
              onCancel={() => setEditMode(false)}
              onAiRetag={handleAiRetag}
              saving={saving}
              retagging={retagging}
            />
          ) : (
            <TagDisplay clip={currentClip} onEdit={openEditMode} />
          )}

          {/* Clip navigation dots */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 10px 0",
              }}
            >
              Page Progress
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {clips.map((clip, i) => {
                return (
                  <button
                    key={clip.id}
                    onClick={() => setCurrentIndex(i)}
                    title={`Clip ${i + 1} — ${clip.review_status}`}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "none",
                      cursor: "pointer",
                      background:
                        i === currentIndex
                          ? "var(--v2-accent)"
                          : clip.review_status === "approved"
                            ? "#00dc82"
                            : clip.review_status === "flagged"
                              ? "#ff8c00"
                              : clip.review_status === "skipped"
                                ? "rgba(255,255,255,0.15)"
                                : clip.review_status === "edited"
                                  ? "rgba(var(--v2-accent-rgb),0.6)"
                                  : "rgba(255,200,0,0.4)",
                      outline:
                        i === currentIndex
                          ? "2px solid var(--v2-accent)"
                          : "none",
                      outlineOffset: 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            alignItems: "center",
            paddingTop: 8,
          }}
        >
          {page > 1 && (
            <a
              href={buildPageHref(libraryId, {
                ...currentFilters,
                page: page - 1,
              })}
              style={paginationLinkStyle}
            >
              ← Prev
            </a>
          )}
          <span style={{ fontSize: 11, color: "rgba(205,195,215,0.4)" }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={buildPageHref(libraryId, {
                ...currentFilters,
                page: page + 1,
              })}
              style={paginationLinkStyle}
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionButton({
  label,
  icon,
  color,
  borderColor,
  bg,
  onClick,
  disabled,
  kbd,
}: {
  label: string;
  icon: string;
  color: string;
  borderColor: string;
  bg: string;
  onClick: () => void;
  disabled: boolean;
  kbd: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${kbd})`}
      style={{
        padding: "7px 12px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${borderColor}`,
        background: bg,
        color,
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
        {icon}
      </span>
      {label}
      <kbd
        style={{
          marginLeft: 2,
          padding: "1px 4px",
          borderRadius: 3,
          background: "rgba(255,255,255,0.08)",
          fontSize: 9,
          fontWeight: 700,
          fontFamily: "monospace",
          color: "rgba(205,195,215,0.6)",
        }}
      >
        {kbd}
      </kbd>
    </button>
  );
}

function TagDisplay({ clip, onEdit }: { clip: Clip; onEdit: () => void }) {
  const groups = [
    {
      key: "characters",
      tags: clip.tags_characters,
      icon: "person",
      color: "#a78bfa",
    },
    { key: "mood", tags: clip.tags_mood, icon: "mood", color: "#34d399" },
    {
      key: "location",
      tags: clip.tags_location,
      icon: "location_on",
      color: "#60a5fa",
    },
    {
      key: "action",
      tags: clip.tags_action,
      icon: "play_circle",
      color: "#f97316",
    },
  ];

  const hasAnyTags = groups.some((g) => g.tags.length > 0);

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: 0,
          }}
        >
          Tags
        </p>
        <button
          onClick={onEdit}
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
            background: "rgba(var(--v2-accent-rgb),0.08)",
            color: "var(--v2-accent)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
            edit
          </span>
          Edit (E)
        </button>
      </div>

      {!hasAnyTags ? (
        <p
          style={{
            color: "rgba(205,195,215,0.3)",
            fontSize: 12,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          No tags yet
        </p>
      ) : (
        groups.map(({ key, tags, icon, color }) =>
          tags.length > 0 ? (
            <div key={key}>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 600,
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
          ) : null,
        )
      )}
    </div>
  );
}

function TagEditor({
  tagVocabulary,
  draftTags,
  draftDescription,
  draftQualityScore,
  draftManualNotes,
  draftIsUsable,
  draftSourceEpisode,
  draftSceneContext,
  draftKeywords,
  onToggle,
  onDescriptionChange,
  onQualityScoreChange,
  onManualNotesChange,
  onIsUsableChange,
  onSourceEpisodeChange,
  onSceneContextChange,
  onKeywordsChange,
  onSave,
  onCancel,
  onAiRetag,
  saving,
  retagging,
}: {
  tagVocabulary: Record<string, string[]>;
  draftTags: {
    characters: string[];
    mood: string[];
    location: string[];
    action: string[];
  };
  draftDescription: string;
  draftQualityScore: number | null;
  draftManualNotes: string;
  draftIsUsable: boolean | null;
  draftSourceEpisode: string;
  draftSceneContext: string;
  draftKeywords: string;
  onToggle: (group: keyof typeof draftTags, value: string) => void;
  onDescriptionChange: (value: string) => void;
  onQualityScoreChange: (v: number | null) => void;
  onManualNotesChange: (v: string) => void;
  onIsUsableChange: (v: boolean | null) => void;
  onSourceEpisodeChange: (v: string) => void;
  onSceneContextChange: (v: string) => void;
  onKeywordsChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onAiRetag: () => void;
  saving: boolean;
  retagging: boolean;
}) {
  const groups: Array<{
    key: keyof typeof draftTags;
    vocabKey: string;
    label: string;
    color: string;
  }> = [
    {
      key: "characters",
      vocabKey: "characters",
      label: "Characters",
      color: "#a78bfa",
    },
    { key: "mood", vocabKey: "mood", label: "Mood", color: "#34d399" },
    {
      key: "location",
      vocabKey: "location",
      label: "Location",
      color: "#60a5fa",
    },
    { key: "action", vocabKey: "action", label: "Action", color: "#f97316" },
  ];

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: 0,
          }}
        >
          Edit Tags
        </p>
        <button
          onClick={onAiRetag}
          disabled={retagging || saving}
          title="Re-run AI tag assignment from existing description"
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            cursor: retagging || saving ? "not-allowed" : "pointer",
            border: "1px solid rgba(167,139,250,0.3)",
            background: "rgba(167,139,250,0.08)",
            color: "#a78bfa",
            display: "flex",
            alignItems: "center",
            gap: 4,
            opacity: retagging ? 0.6 : 1,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
            {retagging ? "progress_activity" : "auto_awesome"}
          </span>
          {retagging ? "Queuing..." : "AI Retag"}
        </button>
      </div>

      {/* Description editor */}
      <div>
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.5)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 6px 0",
          }}
        >
          Description
        </p>
        <textarea
          value={draftDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
            color: "#e5e2e1",
            fontSize: 12,
            lineHeight: 1.5,
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
          placeholder="AI-generated scene description…"
        />
      </div>

      {groups.map(({ key, vocabKey, label, color }) => {
        const vocab = tagVocabulary[vocabKey] ?? [];
        if (vocab.length === 0) return null;
        return (
          <div key={key}>
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 8px 0",
              }}
            >
              {label}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {vocab.map((v) => {
                const selected = draftTags[key].includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onToggle(key, v)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: selected
                        ? `${color}20`
                        : "rgba(255,255,255,0.04)",
                      color: selected ? color : "rgba(205,195,215,0.5)",
                      border: selected
                        ? `1px solid ${color}40`
                        : "1px solid rgba(255,255,255,0.08)",
                      transition: "all 0.1s",
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Human review fields ───────────────────────────────────────────── */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: 0,
          }}
        >
          Review Metadata
        </p>

        {/* Quality score */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 6px 0",
            }}
          >
            Quality (1–5)
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            {[null, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={String(n)}
                type="button"
                onClick={() => onQualityScoreChange(n)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  background:
                    draftQualityScore === n
                      ? "rgba(255,200,0,0.2)"
                      : "rgba(255,255,255,0.04)",
                  color:
                    draftQualityScore === n
                      ? "#ffc800"
                      : "rgba(205,195,215,0.4)",
                  border:
                    draftQualityScore === n
                      ? "1px solid rgba(255,200,0,0.4)"
                      : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {n === null
                  ? "–"
                  : n === 1
                    ? "1★"
                    : n === 2
                      ? "2★"
                      : n === 3
                        ? "3★"
                        : n === 4
                          ? "4★"
                          : "5★"}
              </button>
            ))}
          </div>
        </div>

        {/* Is usable */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 6px 0",
            }}
          >
            Usable for Production
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            {([null, true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => onIsUsableChange(v)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  background:
                    draftIsUsable === v
                      ? v === true
                        ? "rgba(0,220,130,0.15)"
                        : v === false
                          ? "rgba(255,80,80,0.12)"
                          : "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.04)",
                  color:
                    draftIsUsable === v
                      ? v === true
                        ? "#00dc82"
                        : v === false
                          ? "#ff5050"
                          : "#cdc3d7"
                      : "rgba(205,195,215,0.4)",
                  border:
                    draftIsUsable === v
                      ? `1px solid ${v === true ? "rgba(0,220,130,0.3)" : v === false ? "rgba(255,80,80,0.25)" : "rgba(255,255,255,0.15)"}`
                      : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {v === null ? "Unset" : v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>

        {/* Source episode */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 5px 0",
            }}
          >
            Source Episode
          </p>
          <input
            type="text"
            value={draftSourceEpisode}
            onChange={(e) => onSourceEpisodeChange(e.target.value)}
            placeholder="e.g. Episode IV – A New Hope"
            style={{
              width: "100%",
              padding: "5px 10px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 11,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Keywords */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 5px 0",
            }}
          >
            Keywords (comma-separated)
          </p>
          <input
            type="text"
            value={draftKeywords}
            onChange={(e) => onKeywordsChange(e.target.value)}
            placeholder="e.g. battle, lightsaber, jedi"
            style={{
              width: "100%",
              padding: "5px 10px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 11,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Scene context */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 5px 0",
            }}
          >
            Scene Context
          </p>
          <textarea
            value={draftSceneContext}
            onChange={(e) => onSceneContextChange(e.target.value)}
            rows={2}
            placeholder="Broader story context, who is fighting, what's happening…"
            style={{
              width: "100%",
              padding: "5px 10px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 11,
              lineHeight: 1.4,
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Manual notes */}
        <div>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 5px 0",
            }}
          >
            Notes
          </p>
          <textarea
            value={draftManualNotes}
            onChange={(e) => onManualNotesChange(e.target.value)}
            rows={2}
            placeholder="Reviewer notes, editing instructions, issues…"
            style={{
              width: "100%",
              padding: "5px 10px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 11,
              lineHeight: 1.4,
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            flex: 1,
            padding: "8px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: saving ? "not-allowed" : "pointer",
            border: "none",
            background: saving
              ? "rgba(var(--v2-accent-rgb),0.4)"
              : "var(--v2-accent)",
            color: "#000",
          }}
        >
          {saving ? "Saving..." : "Save Tags (Enter)"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(205,195,215,0.6)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MetaPill({
  label,
  value,
  onClick,
  title,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        padding: "5px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
        cursor: onClick ? "pointer" : "default",
        transition: onClick
          ? "background 0.15s, border-color 0.15s"
          : undefined,
        userSelect: "none",
      }}
      onMouseEnter={
        onClick
          ? (e) => {
              e.currentTarget.style.background =
                "rgba(var(--v2-accent-rgb),0.1)";
              e.currentTarget.style.borderColor =
                "rgba(var(--v2-accent-rgb),0.35)";
            }
          : undefined
      }
      onMouseLeave={
        onClick
          ? (e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.borderColor =
                "rgba(var(--v2-accent-rgb),0.08)";
            }
          : undefined
      }
    >
      <p
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: onClick ? "var(--v2-accent)" : "rgba(205,195,215,0.35)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: "0 0 2px 0",
          display: "flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {onClick && (
          <span className="material-symbols-outlined" style={{ fontSize: 9 }}>
            play_arrow
          </span>
        )}
        {label}
      </p>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1", margin: 0 }}>
        {value}
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: disabled ? "rgba(205,195,215,0.2)" : "#e5e2e1",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
  };
}

const paginationLinkStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  textDecoration: "none",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#cdc3d7",
};

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const msRemainder = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(msRemainder).padStart(3, "0").slice(0, 2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function buildPageHref(
  libraryId: string,
  filters: {
    status: string;
    labelingStep: string;
    sourceVideoId?: string;
    page: number;
  },
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.labelingStep) params.set("labeling_step", filters.labelingStep);
  if (filters.sourceVideoId)
    params.set("source_video_id", filters.sourceVideoId);
  params.set("page", String(filters.page));
  return `/clip-library/${libraryId}/review?${params.toString()}`;
}
