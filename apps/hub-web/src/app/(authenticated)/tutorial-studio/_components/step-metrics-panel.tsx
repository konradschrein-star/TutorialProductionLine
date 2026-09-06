"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Industry-4.0 step metrics panel — lives in the Tutorial Studio Dashboard tab.
 * Reads /api/production/tutorial-metrics and visualizes, per VA, how long each
 * production step takes, where the bottleneck is, the day-of-week scripting
 * pattern, and a per-event production timeline. Owner/admin "total clarity".
 */

type StepKey = "script" | "audio" | "record" | "finish";

interface VAStep {
  userId: string | null;
  name: string | null;
  completed: number;
  script_min: number | null;
  audio_min: number | null;
  record_min: number | null;
  finish_min: number | null;
  bottleneck: StepKey | null;
}
interface DowPoint {
  dow: number;
  avg_script_min: number | null;
  samples: number;
}
interface IntradayPoint {
  va: string | null;
  hour: number; // fractional hour-of-day 0..24
}
interface Payload {
  steps: VAStep[];
  dow: DowPoint[];
  intraday: IntradayPoint[];
  windowDays: number;
}

// Splice/"finish" is the automated stitcher (recorded → completed). The VA does
// not spend hands-on time on it, so it is deliberately left out of the per-VA
// time breakdown and bottleneck — tracking it as VA labour was misleading.
const STEP_ORDER: StepKey[] = ["script", "audio", "record"];
const STEP_LABEL: Record<StepKey, string> = {
  script: "Script",
  audio: "Audio",
  record: "Recording",
  finish: "Splice",
};
const STEP_COLOR: Record<StepKey, string> = {
  script: "var(--v2-accent)",
  audio: "#4bd6c8",
  record: "#f0a642",
  finish: "#7ecb6a",
};
const VA_COLORS = ["var(--v2-accent)", "#4bd6c8", "#f0a642", "#7ecb6a", "#c084fc", "#60a5fa", "#f472b6"];
const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WINDOWS = [7, 28, 90] as const;

function fmtMin(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}s`;
  if (v < 60) return `${v.toFixed(v < 10 ? 1 : 0)}m`;
  return `${(v / 60).toFixed(1)}h`;
}

const card: React.CSSProperties = {
  background: "var(--v2-surface-2)",
  border: "1px solid var(--v2-border-1)",
  borderRadius: 14,
  padding: 20,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--v2-text-2)",
};

export function StepMetricsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [windowDays, setWindowDays] = useState<number>(28);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/production/tutorial-metrics?window=${windowDays}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Payload) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [windowDays]);

  const maxStepTotal = useMemo(() => {
    if (!data) return 1;
    let m = 0;
    for (const v of data.steps) {
      const t = (v.script_min ?? 0) + (v.audio_min ?? 0) + (v.record_min ?? 0);
      if (t > m) m = t;
    }
    return m || 1;
  }, [data]);

  const overall = useMemo(() => {
    if (!data || data.steps.length === 0) return null;
    const acc: Record<StepKey, { sum: number; n: number }> = {
      script: { sum: 0, n: 0 },
      audio: { sum: 0, n: 0 },
      record: { sum: 0, n: 0 },
      finish: { sum: 0, n: 0 },
    };
    for (const v of data.steps) {
      for (const k of STEP_ORDER) {
        const val = v[`${k}_min` as const] as number | null;
        if (val != null) {
          acc[k].sum += val;
          acc[k].n += 1;
        }
      }
    }
    const avgs = STEP_ORDER.map((k) => ({ k, avg: acc[k].n ? acc[k].sum / acc[k].n : null }));
    const worst = avgs.reduce<{ k: StepKey; avg: number } | null>(
      (best, cur) => (cur.avg != null && (!best || cur.avg > best.avg) ? { k: cur.k, avg: cur.avg } : best),
      null,
    );
    return { avgs, worst };
  }, [data]);

  const dowMax = useMemo(
    () => Math.max(1, ...(data?.dow.map((d) => d.avg_script_min ?? 0) ?? [1])),
    [data],
  );

  const hasData = !!data && data.steps.some((s) => s.completed > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--v2-text-1)" }}>
            Step Durations &amp; Bottlenecks
          </div>
          <div style={{ fontSize: 12, color: "var(--v2-text-3)" }}>
            How long each production step takes per VA — the industrial floor, instrumented.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--v2-surface-3)", padding: 3, borderRadius: 8 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                background: windowDays === w ? "var(--v2-accent)" : "transparent",
                color: windowDays === w ? "#000" : "var(--v2-text-2)",
              }}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ ...card, color: "var(--v2-error, #ff8080)", fontSize: 13 }}>
          Could not load metrics: {error}
        </div>
      )}

      {!error && loading && !data && (
        <div style={{ ...card, color: "var(--v2-text-3)", fontSize: 13 }}>Loading metrics…</div>
      )}

      {!error && data && !hasData && (
        <div style={{ ...card, color: "var(--v2-text-3)", fontSize: 13 }}>
          No completed tutorials in this window yet — step metrics populate automatically as VAs
          produce videos.
        </div>
      )}

      {!error && data && hasData && (
        <>
          {/* Overall "where time goes" + bottleneck callout */}
          {overall && (
            <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {overall.avgs.map(({ k, avg }) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--v2-text-3)" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: STEP_COLOR[k], marginRight: 6 }} />
                      {STEP_LABEL[k]}
                    </span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "var(--v2-text-1)" }}>{fmtMin(avg)}</span>
                    <span style={{ fontSize: 10, color: "var(--v2-text-3)" }}>avg / video</span>
                  </div>
                ))}
              </div>
              {overall.worst && (
                <div style={{ marginLeft: "auto", padding: "10px 16px", borderRadius: 10, background: "rgba(240,166,66,0.10)", border: "1px solid rgba(240,166,66,0.35)" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#f0a642" }}>Floor bottleneck</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--v2-text-1)" }}>
                    {STEP_LABEL[overall.worst.k]} · {fmtMin(overall.worst.avg)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-VA stacked step bars */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={sectionTitle}>Per-VA step time (avg / video)</span>
              <div style={{ display: "flex", gap: 14 }}>
                {STEP_ORDER.map((k) => (
                  <span key={k} style={{ fontSize: 10, color: "var(--v2-text-3)", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: STEP_COLOR[k] }} />
                    {STEP_LABEL[k]}
                  </span>
                ))}
              </div>
            </div>
            {data.steps.filter((v) => v.completed > 0).map((v) => {
              const total = (v.script_min ?? 0) + (v.audio_min ?? 0) + (v.record_min ?? 0);
              return (
                <div key={v.userId ?? v.name ?? Math.random()} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v2-text-1)" }}>{v.name ?? "Unknown VA"}</div>
                    <div style={{ fontSize: 10, color: "var(--v2-text-3)" }}>{v.completed} done · {fmtMin(total)} total</div>
                  </div>
                  <div style={{ flex: 1, display: "flex", height: 26, borderRadius: 6, overflow: "hidden", background: "var(--v2-surface-4)" }}>
                    {STEP_ORDER.map((k) => {
                      const val = v[`${k}_min` as const] as number | null;
                      if (!val || val <= 0) return null;
                      const pct = (val / maxStepTotal) * 100;
                      const isBottleneck = v.bottleneck === k;
                      return (
                        <div
                          key={k}
                          title={`${v.name ?? "VA"} · ${STEP_LABEL[k]}: ${fmtMin(val)}${isBottleneck ? " (bottleneck)" : ""}`}
                          style={{
                            width: `${pct}%`,
                            background: STEP_COLOR[k],
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#04170a",
                            boxShadow: isBottleneck ? "inset 0 0 0 2px #fff" : "none",
                            minWidth: pct > 6 ? 0 : 3,
                          }}
                        >
                          {pct > 9 ? fmtMin(val) : ""}
                        </div>
                      );
                    })}
                  </div>
                  {v.bottleneck && (
                    <span style={{ width: 78, flexShrink: 0, fontSize: 10, color: "#f0a642", textAlign: "right" }}>
                      ▲ {STEP_LABEL[v.bottleneck]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Scripting time by weekday */}
          <div style={{ ...card }}>
            <div style={{ ...sectionTitle, marginBottom: 14 }}>Scripting time by weekday</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130 }}>
              {DOW_LABEL.map((lbl, i) => {
                const pt = data.dow.find((d) => d.dow === i);
                const val = pt?.avg_script_min ?? 0;
                const h = val > 0 ? Math.max(4, (val / dowMax) * 110) : 2;
                const isWorst = val > 0 && val === dowMax;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: isWorst ? "#f0a642" : "var(--v2-text-3)", fontWeight: isWorst ? 700 : 400 }}>{val > 0 ? fmtMin(val) : ""}</span>
                    <div
                      title={`${lbl}: ${fmtMin(pt?.avg_script_min ?? null)} avg script (${pt?.samples ?? 0} videos)`}
                      style={{ width: "100%", height: h, borderRadius: "4px 4px 0 0", background: isWorst ? "#f0a642" : "var(--v2-accent)", opacity: val > 0 ? 1 : 0.25 }}
                    />
                    <span style={{ fontSize: 10, color: "var(--v2-text-3)" }}>{lbl}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily production rhythm — the 24h clock: WHEN videos are actually made */}
          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <span style={sectionTitle}>Daily production rhythm · when videos are actually made</span>
              <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                each dot = one video by hour of day · line = hourly density · reveals real working hours
              </span>
            </div>
            <DailyRhythm points={data.intraday} />
          </div>
        </>
      )}
    </div>
  );
}

function DailyRhythm({ points }: { points: IntradayPoint[] }) {
  const byVa = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const p of points) {
      const k = p.va ?? "Unknown VA";
      const a = m.get(k) ?? [];
      a.push(p.hour);
      m.set(k, a);
    }
    return Array.from(m.entries());
  }, [points]);

  if (points.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--v2-text-3)" }}>No completed videos in this window yet.</div>;
  }

  const fmtH = (h: number) =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* hour axis */}
      <div style={{ position: "relative", height: 12 }}>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span
            key={h}
            style={{ position: "absolute", left: `${(h / 24) * 100}%`, transform: "translateX(-50%)", fontSize: 9, color: "var(--v2-text-3)" }}
          >
            {h}h
          </span>
        ))}
      </div>
      {byVa.map(([va, hours], i) => {
        const color = VA_COLORS[i % VA_COLORS.length];
        const sorted = [...hours].sort((a, b) => a - b);
        const lo = sorted[Math.floor((sorted.length - 1) * 0.05)];
        const hi = sorted[Math.ceil((sorted.length - 1) * 0.95)];
        const span = Math.max(0, hi - lo);
        const buckets = new Array(24).fill(0);
        for (const h of hours) buckets[Math.min(23, Math.max(0, Math.floor(h)))]++;
        const maxB = Math.max(...buckets, 1);
        const line = buckets
          .map((c, h) => `${((h + 0.5) / 24) * 100},${100 - (c / maxB) * 88}`)
          .join(" ");
        return (
          <div key={va}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3, flexWrap: "wrap", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v2-text-1)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
                {va}
              </span>
              <span style={{ fontSize: 11, color: "var(--v2-text-3)" }}>
                {hours.length} videos · active{" "}
                <span style={{ color: "var(--v2-text-1)" }}>
                  {fmtH(lo)}–{fmtH(hi)}
                </span>{" "}
                · <span style={{ color, fontWeight: 700 }}>{span.toFixed(1)}h</span> window
              </span>
            </div>
            <div style={{ position: "relative", height: 54, background: "var(--v2-surface-3)", borderRadius: 8, overflow: "hidden" }}>
              {/* active-window band */}
              <div style={{ position: "absolute", left: `${(lo / 24) * 100}%`, width: `${(span / 24) * 100}%`, top: 0, bottom: 0, background: color, opacity: 0.1 }} />
              {/* gridlines */}
              {[6, 12, 18].map((h) => (
                <div key={h} style={{ position: "absolute", left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: 1, background: "var(--v2-border-0)" }} />
              ))}
              {/* hourly density line */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <polyline points={line} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.85} />
              </svg>
              {/* one dot per produced video, on the baseline */}
              {hours.map((h, j) => (
                <span
                  key={j}
                  style={{ position: "absolute", left: `${(h / 24) * 100}%`, bottom: 6, width: 5, height: 5, marginLeft: -2.5, borderRadius: "50%", background: color, opacity: 0.55 }}
                />
              ))}
              {/* baseline */}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 6, height: 1, background: "var(--v2-border-1)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
