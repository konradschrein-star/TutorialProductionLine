"use client";

import { Card } from "../_components/atoms";
import type { CfData } from "../_lib/types";
import { statusMeta } from "../_lib/display";

interface Props {
  data: CfData;
}

export function DashboardScreen({ data }: Props) {
  const stats = data.stats ?? {};
  // Sum over whatever the console API actually reports rather than three
  // hardcoded queue names — that way a fourth cf-* queue (finishing-render)
  // is picked up automatically once the aggregator returns it.
  const queues = data.queueDepths ?? [];
  const qActive = queues.reduce((s, q) => s + q.active, 0);
  const qWaiting = queues.reduce((s, q) => s + q.waiting, 0);

  // ── Health cards ─────────────────────────────────────────────────────
  const totalDLQ = stats.dlq ?? 0;
  const inactiveAccounts = (stats.accounts ?? 0) - (stats.accounts_active ?? 0);
  // `pct: null` means "we have no honest denominator" — the card renders no
  // progress bar at all instead of a made-up fill.
  const health: Array<{
    label: string;
    value: string;
    unit: string;
    color: string;
    pct: string | null;
    sub: string;
  }> = [
    {
      // Was a hardcoded "3 / 3 workers · 100%" health bar with a fixed name
      // list. Nothing in CfData reports worker liveness, and there are four
      // cf-* queues, not three. This now reports live BullMQ job counts.
      label: "JOBS IN FLIGHT",
      value: data.loadError ? "—" : String(qActive),
      unit: "active",
      color: data.loadError ? "#cf7468" : qActive > 0 ? "#57a578" : "#6b727b",
      pct: null,
      sub: data.loadError
        ? "console API unreachable"
        : queues.length > 0
          ? `${queues.length} cf-* queue${queues.length === 1 ? "" : "s"} reporting`
          : "no queue depths reported",
    },
    {
      label: "QUEUE BACKLOG",
      value: data.loadError ? "—" : String(qWaiting),
      unit: "waiting",
      color: qWaiting > 10 ? "#b388c9" : "#57a578",
      pct: Math.min(100, qWaiting * 5).toFixed(0) + "%",
      sub: "across cf-* queues",
    },
    {
      // Was `pct: "32%"` — a magic number with no relation to the DLQ size.
      // There is no known "max acceptable DLQ", so the bar is dropped.
      label: "DLQ",
      value: String(totalDLQ),
      unit: "jobs",
      color: totalDLQ > 0 ? "#cf7468" : "#57a578",
      pct: null,
      sub: totalDLQ > 0 ? "awaiting triage" : "clean",
    },
    {
      label: "INACTIVE ACCOUNTS",
      value: String(inactiveAccounts),
      unit: `/${stats.accounts ?? 0}`,
      color: inactiveAccounts > 0 ? "#b388c9" : "#57a578",
      pct: stats.accounts
        ? (inactiveAccounts / stats.accounts) * 100 + "%"
        : "0%",
      sub: "paused or flagged",
    },
  ];

  // ── KPI strip — real counts ─────────────────────────────────────────
  const kpiCards = [
    {
      label: "SOURCES",
      value: stats.sources ?? 0,
      sub: "ingested",
      col: "#7b93d4",
    },
    {
      label: "RAW CLIPS",
      value: stats.clips ?? 0,
      sub: `${stats.clips_ready ?? 0} ready`,
      col: "#7b93d4",
    },
    {
      label: "DISTRIBUTIONS",
      value: stats.distributions ?? 0,
      sub: `${stats.dists_live ?? 0} live`,
      col: "#57a578",
    },
    {
      label: "ACCOUNTS",
      value: stats.accounts ?? 0,
      sub: `${stats.accounts_active ?? 0} active`,
      col: "#57a578",
    },
    {
      label: "ERRORS",
      value: stats.errors ?? 0,
      sub: "in DLQ",
      col: "#cf7468",
    },
  ];

  // ── Funnel — real DB counts ────────────────────────────────────────
  const funnelStages = [
    { label: "Sources", value: stats.sources ?? 0, fill: "#3a444f" },
    { label: "Raw Clips", value: stats.clips ?? 0, fill: "#3a444f" },
    { label: "Ready", value: stats.clips_ready ?? 0, fill: "#3a444f" },
    { label: "Distributed", value: stats.distributions ?? 0, fill: "#7b93d4" },
    { label: "Live", value: stats.dists_live ?? 0, fill: "#57a578" },
  ];
  const peak = Math.max(...funnelStages.map((s) => s.value), 1);
  const funnel = funnelStages.map((f, i) => {
    const prev = i > 0 ? funnelStages[i - 1].value : f.value;
    const drop = prev > 0 ? Math.round(((prev - f.value) / prev) * 100) : 0;
    return {
      ...f,
      h: Math.max(8, (f.value / peak) * 100) + "%",
      drop: i > 0 && drop > 0 ? `${drop}%` : "",
    };
  });

  // ── Pool supply — real per-account undistributed counts ────────────
  // The bar used to be scaled against a magic denominator of 40 and labelled
  // "% of full supply"; there is no such target anywhere. Bars are now
  // relative to the largest supply actually observed across accounts, which
  // is the only scale the data supports.
  const supplyPeak = Math.max(1, ...data.accounts.map((a) => a.supply));
  const supply = data.accounts.slice(0, 8).map((a) => ({
    handle: a.handle,
    count: a.supply,
    pct: ((a.supply / supplyPeak) * 100).toFixed(0) + "%",
    color: a.supply < 8 ? "#b388c9" : "#57a578",
    low: a.supply < 8,
  }));

  // ── Activity — real current status per row ─────────────────────────
  // This used to render "from → to" transitions, but the `from` state was
  // invented ("ingested"/"detected"/"queued" hardcoded per table) and so was
  // the `layer` attribution. No previous-state is stored anywhere the UI can
  // see. The console API does return a real `recent_activity` array, but it
  // is not plumbed through _lib/fetch.ts into CfData, so we render the real
  // *current* status of the newest rows instead of inventing a history.
  const recentActivity = (
    data.sources.slice(0, 6).map((s) => ({
      time: s.ingestedAt,
      kind: "source",
      status: s.status,
      corr: `src_${s.id}`,
    })) as Array<{
      time: string;
      kind: string;
      status: string;
      corr: string;
    }>
  )
    .concat(
      data.clips.slice(0, 8).map((c) => ({
        time: "",
        kind: "clip",
        status: c.status,
        corr: `clip_${c.id}`,
      })),
    )
    .concat(
      data.dists.slice(0, 5).map((d) => ({
        time: d.up.slice(-5) || "",
        kind: "dist",
        status: d.status,
        corr: `dist_${d.id}`,
      })),
    )
    .slice(0, 20);

  return (
    <div style={{ padding: "14px 16px 26px" }}>
      {!data.loaded && (
        <div
          style={{
            marginBottom: 14,
            padding: "9px 14px",
            border: "1px solid #34425c",
            borderLeft: "3px solid #7b93d4",
            borderRadius: 5,
            background: "rgba(123,147,212,.08)",
            fontSize: 12,
            color: "#9bb1e0",
          }}
        >
          Loading live state from /api/v1/clip-forge/console…
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {health.map((c) => (
          <Card
            key={c.label}
            pad={12}
            style={{ display: "flex", flexDirection: "column", gap: 9 }}
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
                  fontSize: 9.5,
                  letterSpacing: ".13em",
                  color: "#6b727b",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                {c.label}
              </span>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: c.color,
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: "#eef1f4",
                }}
              >
                {c.value}
              </span>
              <span style={{ fontSize: 12, color: "#6b727b" }}>{c.unit}</span>
            </div>
            {/* No bar when there is no honest denominator (pct === null). */}
            {c.pct !== null && (
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background: "#171c22",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: c.pct,
                    background: c.color,
                    borderRadius: 3,
                  }}
                />
              </div>
            )}
            <span style={{ fontSize: 10.5, color: "#6b727b" }}>{c.sub}</span>
          </Card>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5,1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {kpiCards.map((k) => (
          <Card key={k.label} pad={11}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  letterSpacing: ".1em",
                  color: "#6b727b",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                {k.label}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 23,
                  fontWeight: 600,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: "#eef1f4",
                }}
              >
                {k.value}
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#59616a" }}>{k.sub}</span>
          </Card>
        ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 12 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card pad={15}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                Production Funnel
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#59616a",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                lifetime · all stages
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
              {funnel.map((f) => (
                <div
                  key={f.label}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      height: 74,
                      padding: "0 7px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        background: f.fill,
                        height: f.h,
                        borderRadius: "3px 3px 0 0",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: -17,
                          left: 0,
                          right: 0,
                          textAlign: "center",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#eef1f4",
                        }}
                      >
                        {f.value}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid #232a32",
                      paddingTop: 6,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "#aeb4bb" }}>
                      {f.label}
                    </div>
                    {f.drop && (
                      <div
                        style={{
                          fontSize: 9.5,
                          color: "#9b8aa8",
                          fontFamily: "'IBM Plex Mono', monospace",
                          marginTop: 2,
                        }}
                      >
                        ▼ {f.drop} drop
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad={15}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                Pool Supply — unused raw clips / account
              </span>
              {supply.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  bars relative to max ({supplyPeak})
                </span>
              )}
              <span style={{ flex: 1 }} />
              {supply.some((s) => s.low) && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#9b8aa8",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  ⚠ low = scheduler starves
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {supply.length === 0 && (
                <div
                  style={{ fontSize: 11, color: "#59616a", padding: "12px 0" }}
                >
                  no accounts yet — add one in{" "}
                  <span style={{ color: "#cfd4da" }}>Accounts</span> after your
                  first persona exists
                </div>
              )}
              {supply.map((s) => (
                <div
                  key={s.handle}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span
                    style={{
                      width: 128,
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.handle}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 4,
                      background: "#161b21",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: s.pct,
                        background: s.color,
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 42,
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: s.color,
                    }}
                  >
                    {s.count}
                  </span>
                  {s.low && (
                    <span
                      style={{
                        fontSize: 9,
                        background: "rgba(179,136,201,.14)",
                        color: "#b388c9",
                        borderRadius: 3,
                        padding: "1px 5px",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      LOW
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card
          pad={0}
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "11px 14px",
              borderBottom: "1px solid #1d232a",
            }}
          >
            {/* The blinking dot implied a live stream. There is no SSE here —
                the console re-fetches on a 4s interval, so say that instead. */}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#57a578",
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              Recent Activity
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 9.5,
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              current status · polled 4s
            </span>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "4px 0",
              maxHeight: 460,
            }}
          >
            {recentActivity.length === 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "#59616a",
                  padding: "26px 16px",
                  textAlign: "center",
                }}
              >
                no activity yet — ingest a source from{" "}
                <span style={{ color: "#cfd4da" }}>Sources</span> to start
              </div>
            )}
            {recentActivity.map((a, i) => {
              const sm = statusMeta(a.status);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "5px 14px",
                    borderBottom: "1px solid #14181d",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#59616a",
                      flex: "0 0 52px",
                    }}
                  >
                    {a.time || "—"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          letterSpacing: ".06em",
                          color: "#828a93",
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        {a.kind}
                      </span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: sm.color,
                        }}
                      >
                        {a.status}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9.5,
                        color: "#4d555e",
                      }}
                    >
                      {a.corr}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
