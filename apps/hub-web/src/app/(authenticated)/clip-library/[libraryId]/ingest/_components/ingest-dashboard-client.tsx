"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceVideo {
  id: string;
  library_id: string;
  ingest_status: string;
  source_url: string | null;
  source_file_path: string | null;
  title: string | null;
  duration_ms: number | null;
  clip_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  libraryId: string;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    bg: string;
    border: string;
    icon: string;
    spinning?: boolean;
  }
> = {
  pending: {
    label: "Pending",
    color: "#ffc800",
    bg: "rgba(255,200,0,0.08)",
    border: "rgba(255,200,0,0.25)",
    icon: "schedule",
  },
  downloading: {
    label: "Downloading",
    color: "var(--v2-accent)",
    bg: "rgba(var(--v2-accent-rgb),0.08)",
    border: "rgba(var(--v2-accent-rgb),0.25)",
    icon: "download",
    spinning: true,
  },
  download_failed: {
    label: "Download Failed",
    color: "#ff5050",
    bg: "rgba(255,80,80,0.08)",
    border: "rgba(255,80,80,0.25)",
    icon: "download_done",
  },
  processing: {
    label: "Processing",
    color: "var(--v2-accent)",
    bg: "rgba(var(--v2-accent-rgb),0.08)",
    border: "rgba(var(--v2-accent-rgb),0.25)",
    icon: "settings",
    spinning: true,
  },
  processing_failed: {
    label: "Processing Failed",
    color: "#ff5050",
    bg: "rgba(255,80,80,0.08)",
    border: "rgba(255,80,80,0.25)",
    icon: "error",
  },
  labeling: {
    label: "Labeling",
    color: "#f97316",
    bg: "rgba(249,115,22,0.08)",
    border: "rgba(249,115,22,0.25)",
    icon: "label",
    spinning: true,
  },
  labeling_failed: {
    label: "Labeling Failed",
    color: "#ff5050",
    bg: "rgba(255,80,80,0.08)",
    border: "rgba(255,80,80,0.25)",
    icon: "error",
  },
  embedding: {
    label: "Embedding",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.25)",
    icon: "hub",
    spinning: true,
  },
  embedding_failed: {
    label: "Embedding Failed",
    color: "#ff5050",
    bg: "rgba(255,80,80,0.08)",
    border: "rgba(255,80,80,0.25)",
    icon: "error",
  },
  ready: {
    label: "Ready",
    color: "#00dc82",
    bg: "rgba(0,220,130,0.08)",
    border: "rgba(0,220,130,0.25)",
    icon: "check_circle",
  },
  archived: {
    label: "Archived",
    color: "rgba(205,195,215,0.4)",
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.08)",
    icon: "archive",
  },
};

const TERMINAL_STATUSES = new Set([
  "ready",
  "archived",
  "download_failed",
  "processing_failed",
  "labeling_failed",
  "embedding_failed",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${seconds}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status.replace(/_/g, " "),
    color: "#cdc3d7",
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.1)",
    icon: "info",
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 12,
          animation: cfg.spinning ? "spin 1.5s linear infinite" : undefined,
        }}
      >
        {cfg.icon}
      </span>
      {cfg.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function IngestDashboardClient({ libraryId }: Props) {
  const [videos, setVideos] = useState<SourceVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [materializeLoading, setMaterializeLoading] = useState(false);
  const [materializeResult, setMaterializeResult] = useState<string | null>(
    null,
  );
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelResult, setLabelResult] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveResult, setApproveResult] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const fetchVideos = useCallback(async () => {
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/source-videos`, {
        cache: "no-store",
      });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const d = await res.json();
          errMsg = d.error ?? errMsg;
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      setVideos(Array.isArray(data.sourceVideos) ? data.sourceVideos : []);
      setLastFetch(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  // Initial fetch
  useEffect(() => {
    void fetchVideos();
  }, [fetchVideos]);

  // Auto-refresh while any video is in a non-terminal state
  useEffect(() => {
    const hasActive = videos.some(
      (v) => !TERMINAL_STATUSES.has(v.ingest_status),
    );
    setAutoRefreshing(hasActive);

    if (!hasActive) return;

    const interval = setInterval(() => {
      void fetchVideos();
    }, 10_000);

    return () => clearInterval(interval);
  }, [videos, fetchVideos]);

  const handleMaterialize = useCallback(async () => {
    setMaterializeLoading(true);
    setMaterializeResult(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/materialize`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.dispatched === 0) {
        setMaterializeResult("All clips already materialized.");
      } else {
        setMaterializeResult(
          `Extraction started for ${data.dispatched} source video${data.dispatched !== 1 ? "s" : ""}. Clips will appear shortly.`,
        );
      }
    } catch (err) {
      setMaterializeResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setMaterializeLoading(false);
    }
  }, [libraryId]);

  const handleTriggerLabeling = useCallback(async () => {
    setLabelLoading(true);
    setLabelResult(null);
    try {
      const res = await fetch(
        `/api/clip-library/${libraryId}/trigger-labeling`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.enqueued === 0) {
        setLabelResult("All clips already labeled.");
      } else {
        setLabelResult(
          `Labeling queued for ${data.enqueued} clip${data.enqueued !== 1 ? "s" : ""}. Check back in a few minutes.`,
        );
      }
    } catch (err) {
      setLabelResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLabelLoading(false);
    }
  }, [libraryId]);

  const handleBulkApprove = useCallback(async () => {
    setApproveLoading(true);
    setApproveResult(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/bulk-approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.approved === 0) {
        setApproveResult(data.message ?? "No labeled-but-pending clips found.");
      } else {
        setApproveResult(
          `${data.approved} clip${data.approved !== 1 ? "s" : ""} approved and ready for selection.`,
        );
      }
    } catch (err) {
      setApproveResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setApproveLoading(false);
    }
  }, [libraryId]);

  const handleDelete = useCallback(
    async (videoId: string) => {
      if (
        !confirm(
          "Delete this source video and all its clips? This cannot be undone.",
        )
      )
        return;
      setDeletingIds((prev) => new Set(prev).add(videoId));
      try {
        const res = await fetch(
          `/api/clip-library/${libraryId}/source-videos/${videoId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          alert(d.error ?? `Delete failed (HTTP ${res.status})`);
          return;
        }
        setVideos((prev) => prev.filter((v) => v.id !== videoId));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(videoId);
          return next;
        });
      }
    },
    [libraryId],
  );

  // Summary stats
  const readyCount = videos.filter((v) => v.ingest_status === "ready").length;
  const activeCount = videos.filter(
    (v) =>
      !TERMINAL_STATUSES.has(v.ingest_status) && v.ingest_status !== "pending",
  ).length;
  const pendingCount = videos.filter(
    (v) => v.ingest_status === "pending",
  ).length;
  const failedCount = videos.filter((v) =>
    [
      "download_failed",
      "processing_failed",
      "labeling_failed",
      "embedding_failed",
    ].includes(v.ingest_status),
  ).length;

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 240,
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
        Loading source videos...
      </div>
    );
  }

  if (error) {
    return (
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
        <button
          onClick={() => void fetchVideos()}
          style={{
            marginLeft: "auto",
            padding: "5px 12px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            background: "rgba(255,80,80,0.1)",
            border: "1px solid rgba(255,80,80,0.3)",
            color: "#ff5050",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 18px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 10,
          flexWrap: "wrap",
        }}
      >
        {[
          { label: "Total", value: videos.length, color: "#e5e2e1" },
          { label: "Ready", value: readyCount, color: "#00dc82" },
          {
            label: "Processing",
            value: activeCount,
            color: "var(--v2-accent)",
          },
          { label: "Pending", value: pendingCount, color: "#ffc800" },
          { label: "Failed", value: failedCount, color: "#ff5050" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}
            >
              {value}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "rgba(205,195,215,0.4)",
              }}
            >
              {label}
            </span>
          </div>
        ))}

        {/* Auto-refresh indicator */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {autoRefreshing && (
            <>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--v2-accent)",
                  animation: "pulse 1.5s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(205,195,215,0.4)",
                  fontWeight: 600,
                }}
              >
                Auto-refreshing every 10s
              </span>
            </>
          )}
          {lastFetch && (
            <span style={{ fontSize: 10, color: "rgba(205,195,215,0.3)" }}>
              · Updated{" "}
              {lastFetch.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={() => void fetchVideos()}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              background: "rgba(var(--v2-accent-rgb),0.08)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              color: "var(--v2-accent)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              refresh
            </span>
            Refresh
          </button>
        </div>
      </div>

      {/* Materialize action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 10,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: "var(--v2-accent)", flexShrink: 0 }}
        >
          movie_creation
        </span>
        <div style={{ flex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#e5e2e1",
            }}
          >
            Materialize Clips
          </p>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
            }}
          >
            Extract each clip into its own MP4 file for instant playback and AI
            use.
          </p>
          {materializeResult && (
            <p
              style={{
                margin: "6px 0 0 0",
                fontSize: 11,
                color: materializeResult.startsWith("Error")
                  ? "#ff5050"
                  : "#00dc82",
              }}
            >
              {materializeResult}
            </p>
          )}
        </div>
        <button
          onClick={() => void handleMaterialize()}
          disabled={materializeLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: materializeLoading ? "not-allowed" : "pointer",
            background: materializeLoading
              ? "rgba(var(--v2-accent-rgb),0.05)"
              : "rgba(var(--v2-accent-rgb),0.12)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
            color: materializeLoading
              ? "rgba(var(--v2-accent-rgb),0.4)"
              : "var(--v2-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              animation: materializeLoading
                ? "spin 1.5s linear infinite"
                : undefined,
            }}
          >
            {materializeLoading ? "progress_activity" : "movie_creation"}
          </span>
          {materializeLoading ? "Starting..." : "Run Extraction"}
        </button>
      </div>

      {/* Trigger labeling action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 10,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: "#f97316", flexShrink: 0 }}
        >
          label
        </span>
        <div style={{ flex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#e5e2e1",
            }}
          >
            Trigger Labeling
          </p>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
            }}
          >
            Queue Gemini VLM + Whisper labeling for all unlabeled clips. Use
            this to recover from stalled jobs.
          </p>
          {labelResult && (
            <p
              style={{
                margin: "6px 0 0 0",
                fontSize: 11,
                color: labelResult.startsWith("Error") ? "#ff5050" : "#00dc82",
              }}
            >
              {labelResult}
            </p>
          )}
        </div>
        <button
          onClick={() => void handleTriggerLabeling()}
          disabled={labelLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: labelLoading ? "not-allowed" : "pointer",
            background: labelLoading
              ? "rgba(249,115,22,0.05)"
              : "rgba(249,115,22,0.12)",
            border: "1px solid rgba(249,115,22,0.25)",
            color: labelLoading ? "rgba(249,115,22,0.4)" : "#f97316",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              animation: labelLoading ? "spin 1.5s linear infinite" : undefined,
            }}
          >
            {labelLoading ? "progress_activity" : "auto_awesome"}
          </span>
          {labelLoading ? "Queuing..." : "Run Labeling"}
        </button>
      </div>

      {/* Bulk Approve card */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          padding: "14px 16px",
          borderRadius: 10,
          background: "rgba(52,211,153,0.04)",
          border: "1px solid rgba(52,211,153,0.15)",
        }}
      >
        <div style={{ flex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "#e5e2e1",
            }}
          >
            Bulk Approve Labeled Clips
          </p>
          <p
            style={{
              margin: "3px 0 0 0",
              fontSize: 11,
              color: "#cdc3d7",
              lineHeight: 1.4,
            }}
          >
            Approves all clips with{" "}
            <code style={{ color: "#34d399", fontSize: 10 }}>
              labeling_step = done
            </code>{" "}
            and{" "}
            <code style={{ color: "#34d399", fontSize: 10 }}>
              review_status = pending
            </code>
            . Required before clip-selection can use them.
          </p>
          {approveResult && (
            <p
              style={{
                margin: "6px 0 0 0",
                fontSize: 11,
                color: approveResult.startsWith("Error")
                  ? "#ff5050"
                  : "#00dc82",
              }}
            >
              {approveResult}
            </p>
          )}
        </div>
        <button
          onClick={() => void handleBulkApprove()}
          disabled={approveLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: approveLoading ? "not-allowed" : "pointer",
            background: approveLoading
              ? "rgba(52,211,153,0.05)"
              : "rgba(52,211,153,0.12)",
            border: "1px solid rgba(52,211,153,0.25)",
            color: approveLoading ? "rgba(52,211,153,0.4)" : "#34d399",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              animation: approveLoading
                ? "spin 1.5s linear infinite"
                : undefined,
            }}
          >
            {approveLoading ? "progress_activity" : "done_all"}
          </span>
          {approveLoading ? "Approving..." : "Approve All"}
        </button>
      </div>

      {/* Table */}
      {videos.length === 0 ? (
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
            style={{ fontSize: 40, color: "rgba(var(--v2-accent-rgb),0.3)" }}
          >
            video_file
          </span>
          <p style={{ color: "#cdc3d7", fontSize: 13, margin: 0 }}>
            No source videos in this library
          </p>
          <Link
            href={`/clip-library/${libraryId}`}
            style={{
              fontSize: 12,
              color: "var(--v2-accent)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Add a source video →
          </Link>
        </div>
      ) : (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                }}
              >
                {[
                  "Title / URL",
                  "Status",
                  "Clips",
                  "Duration",
                  "Added",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "11px 16px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "rgba(205,195,215,0.4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {videos.map((video, i) => {
                const isFailed = [
                  "download_failed",
                  "processing_failed",
                  "labeling_failed",
                  "embedding_failed",
                ].includes(video.ingest_status);
                return (
                  <tr
                    key={video.id}
                    style={{
                      borderBottom:
                        i < videos.length - 1
                          ? "1px solid rgba(255,255,255,0.03)"
                          : undefined,
                    }}
                  >
                    {/* Title / URL */}
                    <td style={{ padding: "14px 16px", maxWidth: 340 }}>
                      <p
                        style={{
                          color: "#e5e2e1",
                          fontSize: 13,
                          fontWeight: 600,
                          margin: "0 0 3px 0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {video.title ??
                          video.source_url ??
                          video.source_file_path ??
                          video.id}
                      </p>
                      {video.source_url && (
                        <a
                          href={video.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "rgba(205,195,215,0.4)",
                            fontSize: 10,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            textDecoration: "none",
                            maxWidth: 280,
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 11, flexShrink: 0 }}
                          >
                            open_in_new
                          </span>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {video.source_url}
                          </span>
                        </a>
                      )}
                      {/* Error message tooltip */}
                      {isFailed && video.error_message && (
                        <p
                          style={{
                            color: "#ff5050",
                            fontSize: 10,
                            margin: "4px 0 0 0",
                            fontFamily: "monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 300,
                          }}
                          title={video.error_message}
                        >
                          ⚠ {video.error_message}
                        </p>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={video.ingest_status} />
                    </td>

                    {/* Clip count */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          color:
                            video.clip_count > 0
                              ? "#e5e2e1"
                              : "rgba(205,195,215,0.3)",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {video.clip_count}
                      </span>
                    </td>

                    {/* Duration */}
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ color: "#cdc3d7", fontSize: 13 }}>
                        {formatDuration(video.duration_ms)}
                      </span>
                    </td>

                    {/* Date added */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          color: "rgba(205,195,215,0.4)",
                          fontSize: 11,
                        }}
                      >
                        {formatDate(video.created_at)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "14px 16px" }}>
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        {video.clip_count > 0 && (
                          <Link
                            href={`/clip-library/${libraryId}/clips?source_video_id=${video.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              textDecoration: "none",
                              background: "rgba(var(--v2-accent-rgb),0.08)",
                              color: "var(--v2-accent)",
                              border:
                                "1px solid rgba(var(--v2-accent-rgb),0.2)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 12 }}
                            >
                              grid_view
                            </span>
                            View Clips
                          </Link>
                        )}
                        <button
                          onClick={() => void handleDelete(video.id)}
                          disabled={deletingIds.has(video.id)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            background: "rgba(255,80,80,0.08)",
                            color: "#ff5050",
                            border: "1px solid rgba(255,80,80,0.2)",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            cursor: deletingIds.has(video.id)
                              ? "not-allowed"
                              : "pointer",
                            opacity: deletingIds.has(video.id) ? 0.5 : 1,
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 12 }}
                          >
                            {deletingIds.has(video.id)
                              ? "hourglass_empty"
                              : "delete"}
                          </span>
                          {deletingIds.has(video.id) ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
