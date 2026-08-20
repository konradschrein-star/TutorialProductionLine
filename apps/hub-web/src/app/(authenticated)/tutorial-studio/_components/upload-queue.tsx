"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { V2Button } from "../../_components";
import {
  cancelUpload,
  dismissUpload,
  enqueueUpload,
  getServerSnapshot,
  getSnapshot,
  retryUpload,
  subscribe,
  type UploadEntry,
} from "@/lib/recording-uploads/manager";

/** Live view of the background upload manager. */
export function useRecordingUploads(): UploadEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function fmtEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

const STATE_COLOR: Record<UploadEntry["state"], string> = {
  queued: "#6b7280",
  uploading: "#3b82f6",
  paused: "#f59e0b",
  finalizing: "#8b5cf6",
  done: "#22c55e",
  error: "#ef4444",
};

const STATE_LABEL: Record<UploadEntry["state"], string> = {
  queued: "Waiting",
  uploading: "Uploading",
  paused: "Paused",
  finalizing: "Assembling on server",
  done: "Uploaded",
  error: "Failed",
};

function UploadRow({ u }: { u: UploadEntry }) {
  const pct = u.fileSize > 0 ? (u.uploadedBytes / u.fileSize) * 100 : 0;
  const fileInput = useRef<HTMLInputElement | null>(null);

  return (
    <div
      style={{
        padding: "10px 12px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--v2-text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={u.jobTitle}
        >
          {u.jobTitle}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: STATE_COLOR[u.state],
            whiteSpace: "nowrap",
          }}
        >
          {STATE_LABEL[u.state]}
        </span>
      </div>

      <div
        style={{
          marginTop: 6,
          height: 5,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: "100%",
            background: STATE_COLOR[u.state],
            transition: "width 300ms linear",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 5,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 10,
          color: "var(--v2-text-2)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          {fmtBytes(u.uploadedBytes)} / {fmtBytes(u.fileSize)} ({pct.toFixed(0)}
          %)
        </span>
        <span>
          {u.state === "uploading" && u.bytesPerSecond > 0
            ? `${fmtBytes(u.bytesPerSecond)}/s · ${fmtEta(u.etaSeconds)}`
            : ""}
        </span>
      </div>

      {u.error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#fca5a5",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 6,
            padding: "6px 8px",
            whiteSpace: "pre-wrap",
          }}
        >
          {u.error}
        </div>
      )}

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {u.state === "error" && !u.needsFile && (
          <V2Button
            variant="accent"
            size="sm"
            onClick={() => retryUpload(u.jobId)}
          >
            Resume
          </V2Button>
        )}
        {u.state === "error" && u.needsFile && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".mp4,.mov,.mkv,.webm"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                enqueueUpload({
                  jobId: u.jobId,
                  jobTitle: u.jobTitle,
                  file: f,
                });
              }}
            />
            <V2Button
              variant="accent"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              Re-attach file
            </V2Button>
          </>
        )}
        {(u.state === "uploading" ||
          u.state === "queued" ||
          u.state === "finalizing") && (
          <V2Button
            variant="outline"
            size="sm"
            onClick={() => void cancelUpload(u.jobId)}
          >
            Cancel
          </V2Button>
        )}
        {(u.state === "error" || u.state === "done") && (
          <V2Button
            variant="ghost"
            size="sm"
            onClick={() => dismissUpload(u.jobId)}
          >
            Dismiss
          </V2Button>
        )}
      </div>
    </div>
  );
}

/**
 * Floating queue of background recording uploads.
 *
 * Mounted at the Tutorial Studio page root (not inside the Studio tab) so it
 * stays on screen while the VA switches to Create and starts the next job —
 * which is the entire point: the upload must not be tied to a component that
 * unmounts.
 */
export function RecordingUploadQueue() {
  const uploads = useRecordingUploads();
  const [collapsed, setCollapsed] = useState(false);

  if (uploads.length === 0) return null;

  const active = uploads.filter(
    (u) => u.state === "uploading" || u.state === "queued",
  ).length;
  const failed = uploads.filter((u) => u.state === "error").length;
  const totalBytes = uploads.reduce((a, u) => a + u.fileSize, 0);
  const doneBytes = uploads.reduce((a, u) => a + u.uploadedBytes, 0);
  const overallPct = totalBytes > 0 ? (doneBytes / totalBytes) * 100 : 0;

  return (
    <div
      style={{
        position: "fixed",
        left: 272,
        bottom: 16,
        width: 340,
        zIndex: 60,
        background: "rgba(18,18,18,0.96)",
        border: `1px solid ${failed ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 12,
        boxShadow: "0 10px 40px rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--v2-text-1)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
          cloud_upload
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>
          {active > 0
            ? `Uploading ${active} recording${active > 1 ? "s" : ""} — ${overallPct.toFixed(0)}%`
            : failed > 0
              ? `${failed} upload${failed > 1 ? "s" : ""} need attention`
              : "Uploads finished"}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {collapsed ? "expand_less" : "expand_more"}
        </span>
      </button>

      {!collapsed && (
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {uploads.map((u) => (
            <UploadRow key={u.jobId} u={u} />
          ))}
        </div>
      )}

      {active > 0 && (
        <div
          style={{
            padding: "6px 12px 9px",
            fontSize: 10,
            color: "var(--v2-text-2)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          Keep this tab open. You can switch tabs and start the next job —
          uploads continue and survive a page reload.
        </div>
      )}
    </div>
  );
}
