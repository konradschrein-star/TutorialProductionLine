"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "../../_components/glass-card";

interface JobRow {
  id: string;
  title: string;
  status: string;
  status_updated_at: string | null;
}

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "DRAMA_TTS_GENERATING", label: "TTS" },
  { key: "DRAMA_TRANSCRIBING", label: "Transcribe" },
  { key: "DRAMA_PROMPT_GENERATING", label: "Prompts" },
  { key: "DRAMA_IMAGE_GENERATING", label: "Images" },
  { key: "DRAMA_VIDEO_GENERATING", label: "Videos" },
  { key: "DRAMA_ASSEMBLING", label: "Assemble" },
  { key: "DRAMA_QC", label: "QC" },
  { key: "AWAITING_QC", label: "Awaiting QC" },
  { key: "AWAITING_UPLOADER", label: "Ready" },
  { key: "UPLOADING", label: "Uploading" },
  { key: "PUBLISHED", label: "Published" },
];

const TERMINAL = new Set([
  "PUBLISHED",
  "DELETED",
  "CANCELLED",
  "FAILED_DRAMA_PIPELINE",
  "FAILED_IRRECOVERABLE",
]);

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: "#4ade80",
  AWAITING_UPLOADER: "#4ade80",
  AWAITING_QC: "#60a5fa",
  FAILED_DRAMA_PIPELINE: "#f87171",
  FAILED_IRRECOVERABLE: "#f87171",
};

function stageIndex(status: string): number {
  const i = STAGE_ORDER.findIndex((s) => s.key === status);
  return i === -1 ? -1 : i;
}

function statusColor(status: string): string {
  if (STATUS_COLOR[status]) return STATUS_COLOR[status];
  if (status.startsWith("FAILED")) return "#f87171";
  return "var(--v2-accent)";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export default function BatchProgressClient({
  initialIds,
}: {
  initialIds: string[];
}) {
  const [ids] = useState<string[]>(initialIds);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [, setNow] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    if (ids.length === 0) return;
    try {
      const res = await fetch(`/api/drama/active-jobs?ids=${ids.join(",")}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as JobRow[];
      // Preserve original ids order so the operator sees them in
      // the order they were created.
      const byId = new Map(data.map((j) => [j.id, j]));
      setJobs(ids.map((id) => byId.get(id)).filter(Boolean) as JobRow[]);
    } catch {
      /* ignore */
    }
  }, [ids]);

  useEffect(() => {
    void refresh();
    const a = setInterval(refresh, 5000);
    // Bump a counter every second so the "time in stage" labels tick
    // without us refetching from the server.
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh]);

  const total = ids.length;
  const finished = jobs.filter(
    (j) => j.status === "PUBLISHED" || j.status === "AWAITING_UPLOADER",
  ).length;
  const failed = jobs.filter((j) => j.status.startsWith("FAILED")).length;
  const inflight = total - finished - failed;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link
          href="/jobs/create/long-form-drama"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "#cdc3d7",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            arrow_back
          </span>
          Create another
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          rocket_launch
        </span>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
          }}
        >
          Batch progress
        </h1>
        <span style={{ fontSize: 13, color: "#cdc3d7" }}>
          {finished} / {total} done · {inflight} in flight ·{" "}
          <span style={{ color: failed > 0 ? "#f87171" : "#cdc3d7" }}>
            {failed} failed
          </span>
        </span>
      </div>

      {total === 0 && (
        <GlassCard style={{ padding: 24, textAlign: "center" }}>
          <span style={{ fontSize: 13, color: "#cdc3d7" }}>
            No job ids provided. Pass <code>?ids=uuid,uuid</code> in the URL, or
            create a batch from the form.
          </span>
        </GlassCard>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {jobs.map((j) => {
          const idx = stageIndex(j.status);
          const terminal = TERMINAL.has(j.status);
          return (
            <Link
              key={j.id}
              href={`/jobs/${j.id}`}
              style={{ textDecoration: "none" }}
            >
              <GlassCard
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#e5e2e1",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {j.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusColor(j.status),
                      background: `${statusColor(j.status)}22`,
                      padding: "3px 10px",
                      borderRadius: 4,
                    }}
                  >
                    {j.status}
                    {!terminal && j.status_updated_at && (
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>
                        · {timeAgo(j.status_updated_at)}
                      </span>
                    )}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  {STAGE_ORDER.map((s, i) => {
                    const done = idx >= 0 && i < idx;
                    const here = idx >= 0 && i === idx;
                    const failedHere =
                      j.status.startsWith("FAILED") && i >= idx;
                    return (
                      <div
                        key={s.key}
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: failedHere
                            ? "#f87171"
                            : done || here
                              ? "#4ade80"
                              : "rgba(255,255,255,0.08)",
                          opacity: here ? 0.7 : 1,
                          position: "relative",
                        }}
                        title={s.label}
                      />
                    );
                  })}
                </div>
              </GlassCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
