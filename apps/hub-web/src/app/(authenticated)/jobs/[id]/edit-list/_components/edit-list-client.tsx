"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { EditListEntry } from "@repo/contracts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  editListId: string;
  editListStatus: string;
  entries: EditListEntry[];
  jobId: string;
  jobStatus: string;
}

// ── Score → colour mapping ─────────────────────────────────────────────────────

function scoreToColor(
  score: number | null | undefined,
  isFallback: boolean,
): string {
  if (isFallback || score == null) return "rgba(255,255,255,0.08)";
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.7) return `rgba(0,220,130,${0.5 + s * 0.5})`;
  if (s >= 0.4) return `rgba(255,200,0,${0.4 + s * 0.5})`;
  return `rgba(255,80,80,${0.4 + s * 0.5})`;
}

function scoreLabel(
  score: number | null | undefined,
  isFallback: boolean,
): string {
  if (isFallback) return "fallback";
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

// ── Coverage heatmap ──────────────────────────────────────────────────────────

function CoverageHeatmap({
  entries,
  activeIndex,
  onClickSegment,
}: {
  entries: EditListEntry[];
  activeIndex: number;
  onClickSegment: (i: number) => void;
}) {
  const totalDurationMs = entries.reduce(
    (sum, e) => sum + (e.end_ms - e.start_ms),
    0,
  );
  if (totalDurationMs === 0) return null;

  return (
    <div
      style={{
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        background: "rgba(0,0,0,0.3)",
      }}
      title="Coverage heatmap — each segment is one sentence; red=poor match, green=strong match, grey=fallback"
    >
      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
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
          Coverage Heatmap — {entries.length} sentences
        </span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {[
            { color: "rgba(255,80,80,0.8)", label: "poor" },
            { color: "rgba(255,200,0,0.8)", label: "ok" },
            { color: "rgba(0,220,130,0.8)", label: "strong" },
            { color: "rgba(255,255,255,0.08)", label: "fallback" },
          ].map(({ color, label }) => (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: color,
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  color: "rgba(205,195,215,0.4)",
                  fontWeight: 600,
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Strip */}
      <div style={{ display: "flex", height: 32, position: "relative" }}>
        {entries.map((entry, i) => {
          const widthPct =
            ((entry.end_ms - entry.start_ms) / totalDurationMs) * 100;
          const isActive = i === activeIndex;
          return (
            <div
              key={entry.id}
              onClick={() => onClickSegment(i)}
              title={`Sentence ${i + 1}: ${entry.sentence_text.slice(0, 60)}…\nScore: ${scoreLabel(entry.match_score, entry.is_fallback)}`}
              style={{
                width: `${widthPct}%`,
                minWidth: 1,
                height: "100%",
                background: scoreToColor(entry.match_score, entry.is_fallback),
                cursor: "pointer",
                outline: isActive ? "2px solid var(--v2-accent)" : "none",
                outlineOffset: -1,
                transition: "opacity 0.1s",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "0.75";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.opacity = "1";
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  index,
  isActive,
  onClick,
}: {
  entry: EditListEntry;
  index: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const scoreColor = entry.is_fallback
    ? "rgba(205,195,215,0.3)"
    : entry.match_score == null
      ? "rgba(205,195,215,0.3)"
      : entry.match_score >= 0.7
        ? "#00dc82"
        : entry.match_score >= 0.4
          ? "#ffc800"
          : "#ff5050";

  const durationMs = entry.end_ms - entry.start_ms;
  const clipCount = entry.clips?.length ?? 0;

  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 90px 90px 100px",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 8,
        cursor: "pointer",
        background: isActive
          ? "rgba(var(--v2-accent-rgb),0.08)"
          : "rgba(255,255,255,0.02)",
        border: isActive
          ? "1px solid rgba(var(--v2-accent-rgb),0.25)"
          : "1px solid rgba(255,255,255,0.04)",
        transition: "all 0.1s",
        alignItems: "center",
      }}
    >
      {/* Index */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(205,195,215,0.4)",
          textAlign: "right",
        }}
      >
        {index + 1}
      </span>

      {/* Sentence text */}
      <p style={{ fontSize: 12, color: "#e5e2e1", margin: 0, lineHeight: 1.4 }}>
        {entry.sentence_text}
      </p>

      {/* Duration */}
      <span
        style={{
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {(durationMs / 1000).toFixed(1)}s
      </span>

      {/* Clip count / fallback badge */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {entry.is_fallback ? (
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              background: "rgba(255,255,255,0.06)",
              color: "rgba(205,195,215,0.4)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            fallback
          </span>
        ) : (
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              background: "rgba(var(--v2-accent-rgb),0.08)",
              color: "var(--v2-accent)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            }}
          >
            {clipCount} clip{clipCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Match score */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: scoreColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {scoreLabel(entry.match_score, entry.is_fallback)}
        </span>
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function EntryDetail({ entry }: { entry: EditListEntry }) {
  const durationMs = entry.end_ms - entry.start_ms;

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <p
        style={{
          fontSize: 14,
          color: "#e5e2e1",
          margin: 0,
          lineHeight: 1.6,
          fontStyle: "italic",
        }}
      >
        &ldquo;{entry.sentence_text}&rdquo;
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <MetaPill
          label="Timeline"
          value={`${(entry.start_ms / 1000).toFixed(1)}s → ${(entry.end_ms / 1000).toFixed(1)}s`}
        />
        <MetaPill
          label="Duration"
          value={`${(durationMs / 1000).toFixed(1)}s`}
        />
        {!entry.is_fallback && entry.match_score != null && (
          <MetaPill
            label="Match"
            value={`${Math.round(entry.match_score * 100)}%`}
            color={
              entry.match_score >= 0.7
                ? "#00dc82"
                : entry.match_score >= 0.4
                  ? "#ffc800"
                  : "#ff5050"
            }
          />
        )}
        {entry.match_reason && (
          <MetaPill label="Search channels" value={entry.match_reason} />
        )}
      </div>

      {entry.is_fallback ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: "rgba(255,200,0,0.06)",
            border: "1px solid rgba(255,200,0,0.2)",
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#ffc800",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 4px",
            }}
          >
            Fallback — no matching clip found
          </p>
          {entry.fallback_prompt && (
            <p
              style={{
                fontSize: 12,
                color: "rgba(205,195,215,0.6)",
                margin: 0,
                fontStyle: "italic",
              }}
            >
              Prompt: &ldquo;{entry.fallback_prompt}&rdquo;
            </p>
          )}
        </div>
      ) : (
        entry.clips &&
        entry.clips.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
              Clips ({entry.clips.length})
            </p>
            {entry.clips.map((seg, i) => (
              <div
                key={seg.clip_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(205,195,215,0.3)",
                    minWidth: 16,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "rgba(205,195,215,0.4)",
                      margin: "0 0 2px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {seg.clip_id}
                  </p>
                  <p style={{ fontSize: 11, color: "#cdc3d7", margin: 0 }}>
                    {(seg.trim_start_ms / 1000).toFixed(2)}s →{" "}
                    {(seg.trim_end_ms / 1000).toFixed(2)}s{" "}
                    <span style={{ color: "rgba(205,195,215,0.4)" }}>
                      (
                      {((seg.trim_end_ms - seg.trim_start_ms) / 1000).toFixed(
                        1,
                      )}
                      s)
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function MetaPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
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
          margin: "0 0 1px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: color ?? "#e5e2e1",
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function EditListClient({
  editListId,
  editListStatus,
  entries,
  jobId,
  jobStatus,
}: Props) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const activeEntry = entries[activeIndex];
  const canReview =
    editListStatus === "needs_review" || editListStatus === "ai_complete";

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(entries.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entries.length]);

  // Scroll active row into view
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeIndex]);

  async function handleDecision(decision: "approved" | "rejected") {
    if (submitting) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/clip-library/edit-lists/${editListId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setStatusMsg({
        text:
          decision === "approved"
            ? "Edit list approved — job advancing to QMS validation."
            : "Edit list rejected — job returned to clip selection.",
        isError: false,
      });
      setTimeout(() => router.push("/jobs"), 1800);
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : "Request failed",
        isError: true,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (entries.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "rgba(205,195,215,0.4)",
          fontSize: 13,
        }}
      >
        Edit list is empty.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Status notification */}
      {statusMsg && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: statusMsg.isError
              ? "rgba(255,80,80,0.1)"
              : "rgba(0,220,130,0.1)",
            color: statusMsg.isError ? "#ff5050" : "#00dc82",
            border: `1px solid ${statusMsg.isError ? "rgba(255,80,80,0.3)" : "rgba(0,220,130,0.3)"}`,
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Coverage heatmap */}
      <CoverageHeatmap
        entries={entries}
        activeIndex={activeIndex}
        onClickSegment={setActiveIndex}
      />

      {/* Main layout: list + detail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left: sentence list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr 90px 90px 100px",
              gap: 12,
              padding: "4px 14px",
            }}
          >
            {["#", "Sentence", "Duration", "Clips", "Score"].map((h) => (
              <span
                key={h}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  textAlign:
                    h === "#"
                      ? "right"
                      : h === "Duration" || h === "Score"
                        ? "right"
                        : "left",
                }}
              >
                {h}
              </span>
            ))}
          </div>

          {entries.map((entry, i) => (
            <div
              key={entry.id}
              ref={i === activeIndex ? activeRowRef : undefined}
            >
              <EntryRow
                entry={entry}
                index={i}
                isActive={i === activeIndex}
                onClick={() => setActiveIndex(i)}
              />
            </div>
          ))}
        </div>

        {/* Right: detail panel + controls */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 20,
          }}
        >
          {activeEntry && <EntryDetail entry={activeEntry} />}

          {/* Keyboard hint */}
          <p
            style={{
              fontSize: 10,
              color: "rgba(205,195,215,0.3)",
              margin: 0,
              textAlign: "center",
            }}
          >
            ↑ / ↓ or J / K to navigate sentences
          </p>

          {/* Approve / Reject */}
          {canReview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => handleDecision("approved")}
                disabled={submitting}
                style={{
                  padding: "11px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: submitting ? "not-allowed" : "pointer",
                  border: "none",
                  background: submitting ? "rgba(0,220,130,0.3)" : "#00dc82",
                  color: "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  check_circle
                </span>
                Approve & Send to QMS
              </button>
              <button
                onClick={() => handleDecision("rejected")}
                disabled={submitting}
                style={{
                  padding: "11px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: submitting ? "not-allowed" : "pointer",
                  border: "1px solid rgba(255,80,80,0.3)",
                  background: "rgba(255,80,80,0.08)",
                  color: "#ff5050",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  refresh
                </span>
                Reject & Re-run Selection
              </button>
            </div>
          )}

          {editListStatus === "approved" && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(0,220,130,0.08)",
                border: "1px solid rgba(0,220,130,0.2)",
                textAlign: "center",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 20,
                  color: "#00dc82",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                verified
              </span>
              <p
                style={{
                  fontSize: 12,
                  color: "#00dc82",
                  margin: 0,
                  fontWeight: 600,
                }}
              >
                Approved — job is in QMS validation
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
