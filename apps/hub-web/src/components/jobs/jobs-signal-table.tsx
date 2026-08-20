"use client";

/**
 * Dense jobs table built to answer "what is going on with my jobs?".
 *
 * Every column is either actionable or explanatory:
 *   - a thumbnail chip so you can see what the job produced;
 *   - the stage plus how long it has been sitting there, flagged when stuck;
 *   - what is actually blocking it, in words;
 *   - artefact chips (video / images on disk) so "did it produce anything?" is
 *     answerable without opening the job;
 *   - inline Retry and the stage-specific action (review images, open studio…).
 *
 * Nothing is fabricated. A job with no artefacts simply shows no chips.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isRetryable,
  isStuck,
  shortDuration,
  stageFor,
} from "@/app/(authenticated)/jobs/_lib/job-stage";

export interface JobsSignalRow {
  id: string;
  title: string;
  status: string;
  format: string;
  channelName: string | null;
  statusUpdatedAt: string;
  updatedAt: string;
  errorMessage: string | null;
  retryCount: number;
  assigneeName: string | null;
  youtubeVideoId: string | null;
  /** Artefacts actually verified on disk — never inferred from status. */
  hasVideo: boolean;
  thumbnailId: string | null;
  failureCount: number;
}

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";
const TEXT_3 = "rgba(205,195,215,0.45)";
const BORDER = "1px solid rgba(var(--v2-accent-rgb), 0.08)";

function Icon({
  name,
  size = 14,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, lineHeight: 1, flexShrink: 0 }}
    >
      {name}
    </span>
  );
}

function RetryButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Retry failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }, [jobId, router]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        title={error ?? "Re-dispatch this job to its queue"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 9px",
          borderRadius: 5,
          fontSize: 10,
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
          color: "#ffb4ab",
          background: "rgba(255,180,171,0.08)",
          border: "1px solid rgba(255,180,171,0.25)",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Icon name="restart_alt" size={12} />
        {busy ? "…" : "Retry"}
      </button>
      {error && (
        <span style={{ fontSize: 9, color: "#ffb4ab", maxWidth: 140 }}>
          {error}
        </span>
      )}
    </span>
  );
}

function ArtefactChips({ row }: { row: JobsSignalRow }) {
  const chips: Array<{ icon: string; label: string; color: string }> = [];
  if (row.hasVideo)
    chips.push({ icon: "movie", label: "video", color: "#23decb" });
  if (row.thumbnailId)
    chips.push({ icon: "image", label: "thumb", color: "#80ccff" });
  if (row.youtubeVideoId)
    chips.push({ icon: "public", label: "live", color: "#23decb" });

  if (chips.length === 0) {
    return <span style={{ fontSize: 10, color: TEXT_3 }}>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            color: c.color,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${c.color}33`,
          }}
        >
          <Icon name={c.icon} size={10} color={c.color} />
          {c.label}
        </span>
      ))}
    </span>
  );
}

export function JobsSignalTable({ jobs }: { jobs: JobsSignalRow[] }) {
  if (jobs.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "48px 20px",
        }}
      >
        <Icon name="inbox" size={28} color={TEXT_3} />
        <p style={{ fontSize: 13, color: TEXT_2, margin: 0 }}>
          No jobs match this filter.
        </p>
      </div>
    );
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 9,
    fontWeight: 700,
    color: TEXT_3,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    whiteSpace: "nowrap",
  };

  const td: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 12,
    color: TEXT_2,
    borderTop: BORDER,
    verticalAlign: "middle",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          minWidth: 900,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...th, width: 56 }}>Thumb</th>
            <th style={th}>Job</th>
            <th style={th}>Stage</th>
            <th style={th}>Waiting</th>
            <th style={th}>What&rsquo;s blocking</th>
            <th style={th}>Made</th>
            <th style={{ ...th, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((row) => {
            const stage = stageFor(row.status);
            const waiting = shortDuration(row.statusUpdatedAt);
            const stuck = isStuck(row.status, row.statusUpdatedAt);

            return (
              <tr key={row.id}>
                {/* Thumbnail — real image or an honest blank */}
                <td style={td}>
                  {row.thumbnailId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/thumbnails/image/${row.thumbnailId}`}
                      alt=""
                      loading="lazy"
                      style={{
                        width: 48,
                        height: 27,
                        objectFit: "cover",
                        borderRadius: 4,
                        display: "block",
                        border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                      }}
                    />
                  ) : (
                    <div
                      title="No thumbnail generated"
                      style={{
                        width: 48,
                        height: 27,
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px dashed rgba(var(--v2-accent-rgb),0.12)",
                      }}
                    >
                      <Icon name="image" size={12} color={TEXT_3} />
                    </div>
                  )}
                </td>

                {/* Title + format/channel */}
                <td style={{ ...td, maxWidth: 320 }}>
                  <Link
                    href={`/jobs/${row.id}`}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: TEXT_1,
                      textDecoration: "none",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.title}
                  >
                    {row.title}
                  </Link>
                  <span style={{ fontSize: 10, color: TEXT_3 }}>
                    {row.format.replace(/_/g, " ")}
                    {row.channelName ? ` · ${row.channelName}` : ""}
                    {row.assigneeName ? ` · ${row.assigneeName}` : ""}
                  </span>
                </td>

                {/* Stage */}
                <td style={td}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "3px 8px",
                      borderRadius: 5,
                      fontSize: 10,
                      fontWeight: 700,
                      color: stage.color,
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${
                        stage.color.startsWith("var")
                          ? "rgba(var(--v2-accent-rgb),0.25)"
                          : stage.color + "33"
                      }`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stage.label}
                  </span>
                  {row.failureCount > 1 && (
                    <span
                      style={{ fontSize: 9, color: "#ffb4ab", marginLeft: 6 }}
                      title={`Has failed ${row.failureCount} times`}
                    >
                      ×{row.failureCount}
                    </span>
                  )}
                </td>

                {/* Time in state */}
                <td style={td}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: stuck ? 700 : 500,
                      color: stuck ? "#f97316" : TEXT_2,
                    }}
                    title={
                      stuck
                        ? "This job has been in this stage far longer than expected"
                        : undefined
                    }
                  >
                    {stuck && <Icon name="warning" size={12} color="#f97316" />}
                    {waiting ?? "—"}
                  </span>
                </td>

                {/* Blocking explanation */}
                <td style={{ ...td, maxWidth: 300 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: row.errorMessage ? "#ffb4ab" : TEXT_2,
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.errorMessage ?? stage.meaning}
                  >
                    {row.errorMessage ?? stage.meaning}
                  </span>
                </td>

                {/* Artefacts produced */}
                <td style={td}>
                  <ArtefactChips row={row} />
                </td>

                {/* Actions */}
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                      justifyContent: "flex-end",
                      flexWrap: "wrap",
                    }}
                  >
                    {isRetryable(row.status) && <RetryButton jobId={row.id} />}
                    {stage.actionLabel && stage.actionPath && (
                      <Link
                        href={`/jobs/${row.id}${stage.actionPath}`}
                        style={{
                          padding: "4px 9px",
                          borderRadius: 5,
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--v2-accent)",
                          background: "rgba(var(--v2-accent-rgb), 0.08)",
                          border: "1px solid rgba(var(--v2-accent-rgb), 0.25)",
                          textDecoration: "none",
                        }}
                      >
                        {stage.actionLabel}
                      </Link>
                    )}
                    {row.youtubeVideoId && (
                      <a
                        href={`https://www.youtube.com/watch?v=${row.youtubeVideoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Watch on YouTube"
                        style={{
                          display: "inline-flex",
                          padding: "4px 7px",
                          borderRadius: 5,
                          color: "#23decb",
                          background: "rgba(35,222,203,0.08)",
                          border: "1px solid rgba(35,222,203,0.25)",
                        }}
                      >
                        <Icon name="open_in_new" size={12} color="#23decb" />
                      </a>
                    )}
                    <Link
                      href={`/jobs/${row.id}`}
                      style={{
                        padding: "4px 9px",
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        color: TEXT_2,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                        textDecoration: "none",
                      }}
                    >
                      Open
                    </Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
