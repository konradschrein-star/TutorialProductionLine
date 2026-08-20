"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useRegisterKeybind } from "../_lib/keybinds";
import { PulseStatusBadge } from "./pulse-status-badge";
import Link from "next/link";

function formatRelativeTime(date: Date): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 86_400_000) {
    return formatDistanceToNow(d, { addSuffix: true });
  }
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function countFailureTransitions(
  history: Array<{ to_status: string }> | null | undefined,
): number {
  if (!history) return 0;
  return history.filter((h) => h.to_status?.startsWith("FAILED_")).length;
}

interface JobRow {
  id: string;
  title: string;
  status: string;
  production_version: string | null;
  format: string;
  updated_at: Date;
  channel?: { name: string } | null;
  assigned_production_va?: { name: string } | null;
  state_machine_history?: Array<{ to_status: string }> | null;
}

interface JobsTableProps {
  jobs: JobRow[];
}

const REVIEW_STATUSES = ["AWAITING_IMAGE_QC", "AWAITING_QC"];
const CLIP_REVIEW_STATUSES = ["AWAITING_CLIP_REVIEW"];

export function JobsTable({ jobs }: JobsTableProps) {
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  // Clamp selected index when jobs change
  useEffect(() => {
    if (selectedIdx >= jobs.length && jobs.length > 0) {
      setSelectedIdx(jobs.length - 1);
    }
  }, [jobs.length, selectedIdx]);

  // Scroll selected row into view
  useEffect(() => {
    rowRefs.current[selectedIdx]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedIdx]);

  // j = down, k = up, enter = open
  useRegisterKeybind(
    { key: "j", description: "Next job row", category: "Jobs" },
    () => setSelectedIdx((i) => Math.min(i + 1, jobs.length - 1)),
    [jobs.length],
  );

  useRegisterKeybind(
    { key: "k", description: "Previous job row", category: "Jobs" },
    () => setSelectedIdx((i) => Math.max(i - 1, 0)),
    [],
  );

  useRegisterKeybind(
    { key: "enter", description: "Open selected job", category: "Jobs" },
    () => {
      const job = jobs[selectedIdx];
      if (job) router.push(`/jobs/${job.id}`);
    },
    [jobs, selectedIdx],
  );

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (jobs.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 0",
          color: "rgba(205,195,215,0.4)",
          fontSize: 13,
          gap: 12,
        }}
      >
        <div style={{ fontSize: 32, opacity: 0.3 }}>◈</div>
        <p style={{ margin: 0 }}>No jobs found</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            }}
          >
            <th style={{ width: 32, padding: "8px 12px", textAlign: "left" }} />
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              Status
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Title
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              Version
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Format
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Channel
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              Assigned VA
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Updated
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "right",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, idx) => {
            const isSelected = idx === selectedIdx;
            const isChecked = checked.has(job.id);
            const needsReview = REVIEW_STATUSES.includes(job.status);
            const needsClipReview = CLIP_REVIEW_STATUSES.includes(job.status);

            return (
              <tr
                key={job.id}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                onClick={() => setSelectedIdx(idx)}
                onDoubleClick={() => router.push(`/jobs/${job.id}`)}
                className="v2-tr"
                style={{
                  borderBottom: "1px solid rgba(75,68,85,0.15)",
                  background: isSelected
                    ? "rgba(var(--v2-accent-rgb), 0.08)"
                    : isChecked
                      ? "rgba(var(--v2-accent-rgb), 0.04)"
                      : "transparent",
                  cursor: "pointer",
                  outline: isSelected
                    ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
                    : "none",
                }}
              >
                {/* Checkbox */}
                <td style={{ padding: "10px 12px", width: 32 }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCheck(job.id)}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    style={{
                      accentColor: "var(--v2-accent)",
                      cursor: "pointer",
                    }}
                  />
                </td>

                {/* Status */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <PulseStatusBadge status={job.status} />
                    {(() => {
                      const failCount = countFailureTransitions(
                        job.state_machine_history,
                      );
                      return failCount > 1 ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 6px",
                            borderRadius: 3,
                            fontSize: 10,
                            fontWeight: 600,
                            background: "rgba(239, 68, 68, 0.1)",
                            color: "#ef4444",
                            border: "1px solid rgba(239, 68, 68, 0.2)",
                          }}
                        >
                          Failed {failCount}×
                        </span>
                      ) : null;
                    })()}
                  </div>
                </td>

                {/* Title */}
                <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                  <span
                    style={{
                      color: "#e5e2e1",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {job.title}
                  </span>
                </td>

                {/* Version badge */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  {job.production_version && (
                    <span
                      style={{
                        padding: "2px 8px",
                        background: "rgba(var(--v2-accent-rgb), 0.1)",
                        border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                        borderRadius: 4,
                        fontSize: 10,
                        color: "var(--v2-accent)",
                        fontWeight: 700,
                      }}
                    >
                      {job.production_version}
                    </span>
                  )}
                </td>

                {/* Format */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <span
                    style={{ color: "rgba(205,195,215,0.7)", fontSize: 11 }}
                  >
                    {job.format.replace(/_/g, " ")}
                  </span>
                </td>

                {/* Channel */}
                <td style={{ padding: "10px 12px" }}>
                  <span
                    style={{ color: "rgba(205,195,215,0.7)", fontSize: 11 }}
                  >
                    {job.channel?.name ?? "—"}
                  </span>
                </td>

                {/* Assigned VA */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <span
                    style={{ color: "rgba(205,195,215,0.5)", fontSize: 11 }}
                  >
                    {job.assigned_production_va?.name ?? "—"}
                  </span>
                </td>

                {/* Updated */}
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <span
                    style={{ color: "rgba(205,195,215,0.4)", fontSize: 11 }}
                  >
                    {formatRelativeTime(job.updated_at)}
                  </span>
                </td>

                {/* Actions */}
                <td
                  style={{
                    padding: "10px 12px",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    {needsClipReview && (
                      <Link
                        href={`/jobs/${job.id}/edit-list`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="v2-btn-warn"
                      >
                        Edit List
                      </Link>
                    )}
                    {needsReview && (
                      <Link
                        href={`/jobs/${job.id}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="v2-btn-warn"
                      >
                        Review
                      </Link>
                    )}
                    <Link
                      href={`/jobs/${job.id}`}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      className="v2-btn-outline"
                    >
                      View
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
