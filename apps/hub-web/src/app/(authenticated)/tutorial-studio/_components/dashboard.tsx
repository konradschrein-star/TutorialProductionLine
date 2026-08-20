"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { GlassCard } from "../../_components";
import { StepMetricsPanel } from "./step-metrics-panel";
import type { TutorialJob } from "@repo/db";

interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

interface VAStats {
  userId: string | null;
  name: string | null;
  count_7d: number;
  count_28d: number;
  count_90d: number;
  count_lifetime: number;
  minutes_7d: number;
  minutes_28d: number;
  minutes_90d: number;
  minutes_lifetime: number;
}

interface VADailyEntry {
  userId: string | null;
  name: string | null;
  count_today: number;
  minutes_today: number;
}

interface VADailyPoint {
  userId: string | null;
  name: string | null;
  day: string;
  count: number;
  minutes: number;
}

interface DashboardProps {
  jobs: TutorialJob[];
  totals: { total: number; week: number };
  leaderboard: LeaderboardEntry[];
  myCompleted: number;
  userId: string;
  vaStats: VAStats[];
  dailyLeaderboard: VADailyEntry[];
  vaTimeseries: VADailyPoint[];
}

type Metric = "count" | "minutes";
type Window = "7d" | "28d" | "90d" | "all";

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "#6366f1",
  GENERATING_SCRIPT: "#f59e0b",
  GENERATING_AUDIO: "#f59e0b",
  READY_TO_RECORD: "#22c55e",
  AWAITING_UPLOAD: "#3b82f6",
  SPLICING: "#f59e0b",
  COMPLETED: "#22c55e",
  FAILED_SCRIPT: "#ef4444",
  FAILED_AUDIO: "#ef4444",
  FAILED_SPLICE: "#ef4444",
  CANCELLED: "#6b7280",
  // The LONG_FORM states were missing, so every one of them fell through to
  // the grey default — the same grey as CANCELLED. A course waiting on a
  // human render looked identical to a dead job.
  AWAITING_RECORDINGS: "#3b82f6",
  RECORDED: "#3b82f6",
  READY_TO_STITCH: "#f59e0b",
  SENT_TO_STITCHER: "#f59e0b",
};

const VA_COLORS = [
  "#a3e635",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
];

interface AttentionJob {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  kind: string;
  detail: string;
  action: string;
  hoursStuck: number;
}

/**
 * Jobs that are stalled and need a person — the surface that did not exist.
 *
 * The stitch reconciler has been diagnosing these correctly every ten minutes
 * and writing the verdict to a log file. On production that meant six LONG_FORM
 * courses stalled for up to 47 days with nothing on any screen to say so. The
 * data was never missing; the place to see it was.
 *
 * Renders NOTHING when there is nothing wrong — this sits at the top of the
 * dashboard, so on a normal day it must cost zero attention.
 */
function NeedsAttention() {
  const [jobs, setJobs] = useState<AttentionJob[]>([]);
  const [scopeAll, setScopeAll] = useState(false);
  const [canSeeEveryone, setCanSeeEveryone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/production/tutorial-attention${scopeAll ? "?scope=all" : ""}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          jobs?: AttentionJob[];
          canSeeEveryone?: boolean;
        };
        if (cancelled) return;
        setJobs(data.jobs ?? []);
        setCanSeeEveryone(Boolean(data.canSeeEveryone));
      } catch {
        // Non-blocking panel: a failure here must never take the dashboard down.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeAll]);

  if (jobs.length === 0 && !canSeeEveryone) return null;
  if (jobs.length === 0 && !scopeAll) {
    // An admin with nothing of their own still needs the switch to check the team.
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setScopeAll(true)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--v2-text-2)",
            textDecoration: "underline",
          }}
        >
          Check everyone&rsquo;s stalled jobs
        </button>
      </div>
    );
  }

  return (
    <GlassCard
      style={{ padding: 20, border: "1px solid rgba(239, 68, 68, 0.35)" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#ef4444",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Needs attention — {jobs.length} stalled{" "}
          {jobs.length === 1 ? "job" : "jobs"}
        </div>
        {canSeeEveryone && (
          <button
            type="button"
            onClick={() => setScopeAll((v) => !v)}
            style={{
              background: "none",
              border: "1px solid var(--v2-border)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--v2-text-2)",
            }}
          >
            {scopeAll ? "Just mine" : "Everyone"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {jobs.map((j) => (
          <div
            key={j.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--v2-text-1)",
                }}
              >
                {j.title}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                  whiteSpace: "nowrap",
                }}
              >
                {j.hoursStuck >= 48
                  ? `${Math.floor(j.hoursStuck / 24)} days`
                  : `${j.hoursStuck}h`}{" "}
                stuck
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              {j.detail}
            </span>
            <span style={{ fontSize: 12, color: "var(--v2-accent)" }}>
              {j.action}
            </span>
            {scopeAll && j.owner && (
              <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                {j.owner}
              </span>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <GlassCard
      style={{
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: accent
          ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
          : undefined,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--v2-text-2)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 900,
          color: accent ? "var(--v2-accent)" : "var(--v2-text-1)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>{sub}</div>
      )}
    </GlassCard>
  );
}

function MetricToggle({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (v: Metric) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "rgba(255,255,255,0.06)",
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {(["count", "minutes"] as Metric[]).map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: "4px 14px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            background: value === opt ? "var(--v2-accent)" : "transparent",
            color: value === opt ? "#fff" : "var(--v2-text-2)",
            transition: "background 200ms, color 200ms",
          }}
        >
          {opt === "count" ? "Count" : "Minutes"}
        </button>
      ))}
    </div>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: Window;
  onChange: (v: Window) => void;
}) {
  const opts: { id: Window; label: string }[] = [
    { id: "7d", label: "7d" },
    { id: "28d", label: "28d" },
    { id: "90d", label: "90d" },
    { id: "all", label: "All" },
  ];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            border:
              value === o.id
                ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
                : "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            background:
              value === o.id
                ? "rgba(var(--v2-accent-rgb), 0.12)"
                : "transparent",
            color: value === o.id ? "var(--v2-accent)" : "var(--v2-text-2)",
            transition: "all 150ms",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VALineChart({
  vaTimeseries,
  metric,
}: {
  vaTimeseries: VADailyPoint[];
  metric: Metric;
}) {
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const last28 = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 27 + i);
    return d.toISOString().split("T")[0]!;
  });

  const vaMap = new Map<
    string,
    { name: string; color: string; data: Map<string, number> }
  >();
  let colorIdx = 0;
  for (const pt of vaTimeseries) {
    const key = pt.userId ?? "unknown";
    if (!vaMap.has(key)) {
      vaMap.set(key, {
        name: pt.name ?? "Unknown",
        color: VA_COLORS[colorIdx++ % VA_COLORS.length]!,
        data: new Map(),
      });
    }
    const val = metric === "count" ? pt.count : pt.minutes;
    vaMap
      .get(key)!
      .data.set(pt.day, (vaMap.get(key)!.data.get(pt.day) ?? 0) + val);
  }

  const vas = Array.from(vaMap.values());
  const allValues = vas.flatMap((va) => last28.map((d) => va.data.get(d) ?? 0));
  const maxY = Math.max(...allValues, 1);

  const W = 700;
  const H = 200;
  const padL = 32;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xStep = plotW / 27;

  const xPos = (i: number) => padL + i * xStep;
  const yPos = (v: number) => padT + plotH - (v / maxY) * plotH;

  const labelIndices = [0, 6, 13, 20, 27];

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const raw = Math.round((svgX - padL) / xStep);
    setHoveredDay(Math.max(0, Math.min(27, raw)));
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }

  if (vas.length === 0) {
    return (
      <div
        style={{
          height: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
          No completions in the last 28 days.
        </span>
      </div>
    );
  }

  const hoveredDate = hoveredDay !== null ? last28[hoveredDay] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredDay(null)}
      >
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const v = Math.round(maxY * frac);
          const y = yPos(v);
          return (
            <g key={frac}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              {frac > 0 && (
                <text
                  x={padL - 4}
                  y={y + 3}
                  fontSize="8"
                  fill="rgba(255,255,255,0.25)"
                  textAnchor="end"
                >
                  {v}
                </text>
              )}
            </g>
          );
        })}

        {/* Lines */}
        {vas.map((va) => (
          <polyline
            key={va.name}
            points={last28
              .map((d, i) => `${xPos(i)},${yPos(va.data.get(d) ?? 0)}`)
              .join(" ")}
            fill="none"
            stroke={va.color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />
        ))}

        {/* Hover crosshair + dots */}
        {hoveredDay !== null && hoveredDate && (
          <>
            <line
              x1={xPos(hoveredDay)}
              x2={xPos(hoveredDay)}
              y1={padT}
              y2={padT + plotH}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
            {vas.map((va) => (
              <circle
                key={va.name}
                cx={xPos(hoveredDay)}
                cy={yPos(va.data.get(hoveredDate) ?? 0)}
                r="3"
                fill={va.color}
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="1"
              />
            ))}
          </>
        )}

        {/* Transparent hit area */}
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="transparent"
          style={{ cursor: "crosshair" }}
        />

        {/* X labels */}
        {labelIndices.map((i) => (
          <text
            key={i}
            x={xPos(i)}
            y={H - 5}
            fontSize="8"
            fill="rgba(255,255,255,0.25)"
            textAnchor="middle"
          >
            {last28[i]?.slice(5)}
          </text>
        ))}
      </svg>

      {/* Tooltip — rendered via portal so parent transforms don't offset it */}
      {mounted &&
        hoveredDay !== null &&
        hoveredDate &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tooltipPos.x + 14,
              top: tooltipPos.y - 20,
              background: "rgba(8,8,8,0.94)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: "8px 12px",
              pointerEvents: "none",
              zIndex: 9999,
              minWidth: 140,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.35)",
                marginBottom: 7,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {hoveredDate}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {vas.map((va) => {
                const val = va.data.get(hoveredDate) ?? 0;
                return (
                  <div
                    key={va.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: va.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.6)",
                        }}
                      >
                        {va.name}
                      </span>
                    </div>
                    <span
                      style={{ fontSize: 11, fontWeight: 700, color: va.color }}
                    >
                      {metric === "count" ? val : `${val}m`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}

      {/* Legend */}
      <div
        style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}
      >
        {vas.map((va) => (
          <div
            key={va.name}
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <div
              style={{
                width: 16,
                height: 2,
                background: va.color,
                borderRadius: 1,
              }}
            />
            <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
              {va.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VAComparisonChart({
  vaStats,
  metric,
  window: win,
}: {
  vaStats: VAStats[];
  metric: Metric;
  window: Window;
}) {
  const getValue = (va: VAStats) => {
    if (metric === "count") {
      if (win === "7d") return va.count_7d;
      if (win === "28d") return va.count_28d;
      if (win === "90d") return va.count_90d;
      return va.count_lifetime;
    } else {
      if (win === "7d") return va.minutes_7d;
      if (win === "28d") return va.minutes_28d;
      if (win === "90d") return va.minutes_90d;
      return va.minutes_lifetime;
    }
  };

  const sorted = [...vaStats].sort((a, b) => getValue(b) - getValue(a));
  const maxVal = Math.max(...sorted.map(getValue), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sorted.map((va, i) => {
        const val = getValue(va);
        const pct = (val / maxVal) * 100;
        const label = metric === "count" ? `${val}` : `${val}m`;
        const color = VA_COLORS[i % VA_COLORS.length]!;
        return (
          <div key={va.userId ?? i}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 5,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "var(--v2-text-1)",
                  fontWeight: 500,
                }}
              >
                {va.name ?? "Unknown"}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color }}>
                {label}
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: "rgba(255,255,255,0.07)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 3,
                  transition: "width 500ms ease",
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductionDashboard({
  jobs,
  totals,
  leaderboard,
  myCompleted,
  userId,
  vaStats,
  dailyLeaderboard,
  vaTimeseries,
}: DashboardProps) {
  const [metric, setMetric] = useState<Metric>("count");
  const [compWindow, setCompWindow] = useState<Window>("all");

  const maxCompleted = Math.max(...leaderboard.map((r) => r.completed), 1);

  const maxDailyCount = Math.max(
    ...dailyLeaderboard.map((v) => v.count_today),
    1,
  );
  const maxDailyMinutes = Math.max(
    ...dailyLeaderboard.map((v) => v.minutes_today),
    1,
  );

  const activeJobs = jobs.filter(
    (j) =>
      j.status !== "COMPLETED" &&
      j.status !== "CANCELLED" &&
      !j.status.startsWith("FAILED"),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <NeedsAttention />

      {/* KPI tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        <Tile
          label="Total Completed"
          value={totals.total}
          sub="All-time finished tutorials"
        />
        <Tile
          label="This Week"
          value={totals.week}
          sub="Completed in last 7 days"
        />
        <Tile
          label="Your Videos"
          value={myCompleted}
          sub="Completed by you"
          accent
        />
        <Tile
          label="Active Jobs"
          value={activeJobs.length}
          sub="In progress right now"
        />
      </div>

      {/* Industry-4.0 step metrics */}
      <StepMetricsPanel />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* All-time leaderboard */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 16,
            }}
          >
            Leaderboard — Completed Tutorials
          </div>

          {leaderboard.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              No completed tutorials yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {leaderboard.slice(0, 10).map((entry, i) => {
                const isMe = entry.userId === userId;
                const pct =
                  maxCompleted > 0 ? (entry.completed / maxCompleted) * 100 : 0;
                return (
                  <div key={entry.userId ?? i}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: isMe ? "var(--v2-accent)" : "var(--v2-text-1)",
                          fontWeight: isMe ? 700 : 400,
                        }}
                      >
                        {i + 1}. {entry.name ?? "Unknown"}
                        {isMe && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 9,
                              color: "var(--v2-accent)",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            You
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--v2-text-1)",
                        }}
                      >
                        {entry.completed}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "rgba(255,255,255,0.07)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: isMe
                            ? "var(--v2-accent)"
                            : "rgba(255,255,255,0.3)",
                          borderRadius: 2,
                          transition: "width 600ms ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Recent jobs */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 16,
            }}
          >
            Your Recent Jobs
          </div>

          {jobs.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              No jobs yet. Go to Create to get started.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {jobs.slice(0, 8).map((j) => (
                <div
                  key={j.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--v2-text-1)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.title}
                  </span>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 9999,
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      background: `${STATUS_COLORS[j.status] ?? "#6b7280"}22`,
                      color: STATUS_COLORS[j.status] ?? "#6b7280",
                      border: `1px solid ${STATUS_COLORS[j.status] ?? "#6b7280"}44`,
                      flexShrink: 0,
                    }}
                  >
                    {j.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* VA Performance section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Section header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "var(--v2-text-1)",
              }}
            >
              VA Performance
            </div>
            <div
              style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 2 }}
            >
              Daily output per VA · last 28 days
            </div>
          </div>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>

        {/* Line chart + comparison side by side */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "3fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 16,
              }}
            >
              Daily {metric === "count" ? "Videos" : "Minutes"} — Last 28 Days
            </div>
            <VALineChart vaTimeseries={vaTimeseries} metric={metric} />
          </GlassCard>

          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Comparison
              </div>
              <WindowPicker value={compWindow} onChange={setCompWindow} />
            </div>

            {vaStats.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}>
                No data yet.
              </p>
            ) : (
              <VAComparisonChart
                vaStats={vaStats}
                metric={metric}
                window={compWindow}
              />
            )}
          </GlassCard>
        </div>

        {/* Daily leaderboard */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 16,
            }}
          >
            Today&apos;s Leaderboard
          </div>

          {dailyLeaderboard.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}>
              No completions today yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {dailyLeaderboard.map((entry, i) => {
                const value =
                  metric === "count" ? entry.count_today : entry.minutes_today;
                const max =
                  metric === "count" ? maxDailyCount : maxDailyMinutes;
                const pct = max > 0 ? (value / max) * 100 : 0;
                const label = metric === "count" ? `${value}` : `${value}m`;
                const isMe = entry.userId === userId;
                return (
                  <div key={entry.userId ?? i}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: isMe ? "var(--v2-accent)" : "var(--v2-text-1)",
                          fontWeight: isMe ? 700 : 400,
                        }}
                      >
                        {i + 1}. {entry.name ?? "Unknown"}
                        {isMe && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 9,
                              color: "var(--v2-accent)",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            You
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--v2-text-1)",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "rgba(255,255,255,0.07)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: isMe
                            ? "var(--v2-accent)"
                            : "rgba(255,255,255,0.3)",
                          borderRadius: 2,
                          transition: "width 600ms ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
