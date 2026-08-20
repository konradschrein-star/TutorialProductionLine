"use client";

import { Card, PersonaChip } from "../_components/atoms";
import type { CfData } from "../_lib/types";

export function AnalyticsScreen({ data }: { data: CfData }) {
  const liveDists = data.dists.filter((d) => d.status === "live");
  const totalViewsK = liveDists.reduce((s, d) => s + (d.viewsK ?? 0), 0);
  const liveCount = liveDists.length;
  const avgViewsK = liveCount > 0 ? Math.round(totalViewsK / liveCount) : 0;

  // Category performance: sum views per category across live dists, going
  // through the clip → categories join.
  const catViews: Record<string, number> = {};
  for (const d of liveDists) {
    const clip = data.clips.find((c) => c.id === d.clip);
    if (!clip) continue;
    for (const cat of clip.cats) {
      catViews[cat] = (catViews[cat] ?? 0) + (d.viewsK ?? 0);
    }
  }
  const sortedCats = Object.entries(catViews).sort((a, b) => b[1] - a[1]);
  const topCategory = sortedCats[0]?.[0] ?? "—";
  const catPeak = Math.max(1, sortedCats[0]?.[1] ?? 1);

  // Platform split
  const platViews: Record<string, number> = {};
  for (const d of liveDists) {
    platViews[d.platform] = (platViews[d.platform] ?? 0) + (d.viewsK ?? 0);
  }
  const platformSplit = Object.entries(platViews)
    .sort((a, b) => b[1] - a[1])
    .map(([name, val]) => ({
      name,
      val: val.toFixed(1) + "k",
      pct: totalViewsK > 0 ? Math.round((val / totalViewsK) * 100) + "%" : "0%",
      barW:
        totalViewsK > 0 ? Math.round((val / totalViewsK) * 100) + "%" : "0%",
    }));

  const kpis = [
    {
      label: "TOTAL VIEWS · LIVE",
      value: totalViewsK ? totalViewsK.toFixed(1) + "k" : "0",
      sub: "across all accounts",
    },
    {
      label: "LIVE POSTS",
      value: String(liveCount),
      sub: "active uploads",
    },
    {
      label: "AVG VIEWS / POST",
      value: avgViewsK ? avgViewsK + "k" : "—",
      sub: liveCount > 0 ? `n=${liveCount}` : "no posts yet",
    },
    {
      label: "TOP CATEGORY",
      value: topCategory,
      sub: catViews[topCategory]
        ? catViews[topCategory].toFixed(1) + "k views"
        : "—",
    },
  ];

  // CSV export of the distribution ledger. Built entirely from the rows the
  // screen already has in memory — no endpoint needed. (The button used to
  // have no onClick at all.)
  const exportCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      [
        "clip",
        "handle",
        "platform",
        "persona",
        "status",
        "scheduled",
        "uploaded",
        "post_url",
        "views_k",
      ].join(","),
      ...data.dists.map((d) =>
        [
          d.clip,
          d.handle,
          d.platform,
          d.persona,
          d.status,
          d.sched,
          d.up,
          d.url,
          d.viewsK,
        ]
          .map(esc)
          .join(","),
      ),
    ];
    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = href;
    el.download = `clip-forge-distributions-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    el.click();
    URL.revokeObjectURL(href);
  };

  // Account leaderboard — sort by viewsK desc
  const board = [...data.accounts]
    .sort((a, b) => b.viewsK - a.viewsK)
    .slice(0, 10)
    .map((a, i) => ({
      ...a,
      rank: String(i + 1).padStart(2, "0"),
    }));

  return (
    <div
      style={{ height: "100%", overflow: "auto", padding: "14px 16px 26px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 13,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600 }}>
          Performance · live distributions
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={exportCsv}
          disabled={data.dists.length === 0}
          title={
            data.dists.length === 0
              ? "no distributions to export"
              : `export ${data.dists.length} distribution rows`
          }
          style={{
            border: "1px solid #2b333c",
            background: "transparent",
            color: data.dists.length === 0 ? "#4d555e" : "#aeb4bb",
            borderRadius: 5,
            padding: "4px 11px",
            cursor: data.dists.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            fontSize: 11,
          }}
        >
          export CSV
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {kpis.map((k) => (
          <Card key={k.label} pad={12}>
            <div
              style={{
                fontSize: 9.5,
                letterSpacing: ".12em",
                color: "#6b727b",
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: 7,
              }}
            >
              {k.label}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace",
                color: "#eef1f4",
              }}
            >
              {k.value}
            </div>
            <div style={{ fontSize: 10.5, color: "#59616a", marginTop: 2 }}>
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 12,
          marginBottom: 12,
        }}
      >
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
              Views snapshot
            </span>
            {/* Label said "current live count by platform", but the bar height
                is each platform's SHARE OF TOTAL VIEWS and the printed number
                is views in k — not a post count. Label now matches the data. */}
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#59616a",
              }}
            >
              share of live views by platform
            </span>
          </div>
          {liveCount === 0 ? (
            <div
              style={{
                padding: "30px 0",
                color: "#59616a",
                fontSize: 11,
                textAlign: "center",
              }}
            >
              no live posts yet — wire up upload first
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                height: 130,
              }}
            >
              {platformSplit.map((p) => (
                <div
                  key={p.name}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: "70%",
                      height: p.barW,
                      minHeight: 4,
                      background: "#4a545f",
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#cfd4da" }}>
                    {p.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#9aa1a9",
                    }}
                  >
                    {p.val}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card pad={15}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 14 }}>
            Platform split
          </div>
          {platformSplit.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: "#59616a",
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              no platform data
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {platformSplit.map((p) => (
                <div key={p.name}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: "#cfd4da" }}>
                      {p.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: "#9aa1a9",
                      }}
                    >
                      {p.val} · {p.pct}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 4,
                      background: "#161b21",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: p.barW,
                        background: "#4a545f",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card pad={15}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 13,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              Category performance
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#59616a",
              }}
            >
              feeds score tuning
            </span>
          </div>
          {sortedCats.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: "#59616a",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              no category data yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {sortedCats.map(([name, val]) => (
                <div
                  key={name}
                  style={{ display: "flex", alignItems: "center", gap: 11 }}
                >
                  <span
                    style={{
                      width: 92,
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#cfd4da",
                    }}
                  >
                    {name}
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
                        width: ((val / catPeak) * 100).toFixed(0) + "%",
                        background: "#4a545f",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 44,
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#9aa1a9",
                    }}
                  >
                    {val.toFixed(1)}k
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card pad={0} style={{ overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "13px 16px",
              borderBottom: "1px solid #1d232a",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              Account leaderboard
            </span>
          </div>
          {board.length === 0 ? (
            <div
              style={{
                padding: "26px 16px",
                textAlign: "center",
                color: "#59616a",
                fontSize: 11,
              }}
            >
              no accounts yet
            </div>
          ) : (
            board.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "8px 16px",
                  borderBottom: "1px solid #14181d",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#59616a",
                    width: 18,
                  }}
                >
                  {b.rank}
                </span>
                <PersonaChip name={b.persona} size={20} />
                <span
                  style={{
                    flex: 1,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#cfd4da",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.handle}
                </span>
                <span style={{ fontSize: 10, color: "#7d8893" }}>
                  {b.platform}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    color: "#eef1f4",
                    width: 60,
                    textAlign: "right",
                  }}
                >
                  {b.viewsK > 0 ? b.viewsK.toFixed(1) + "k" : "—"}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
