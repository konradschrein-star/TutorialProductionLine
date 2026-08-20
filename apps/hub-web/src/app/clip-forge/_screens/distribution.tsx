"use client";

// NOTE: this screen used to offer a "timeline" view alongside the ledger.
// Every value in it was invented — lane positions were `((ai*7 + mi*19) % 70)
// + 5`, statuses were cycled by `mi % 4`, and the clip ids were synthetic
// `clip_20300+` strings that exist nowhere in the data. The only real
// scheduling field we have is `CfDist.sched`, a relative "+Nh" string, which
// is not enough to place marks on a 72h axis. The view (and its toggle) were
// removed rather than replaced with another guess.
import { useMemo, useState } from "react";
import { StatusPill } from "../_components/atoms";
import type { CfData } from "../_lib/types";
import { personaMeta } from "../_lib/display";

const STATUS_FILTERS = [
  "assigned",
  "rendered",
  "qc_pass",
  "qc_flag",
  "queued",
  "live",
  "failed",
  "skipped",
];

export function DistributionScreen({ data }: { data: CfData }) {
  const [platform, setPlatform] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const rows = useMemo(() => {
    return data.dists.filter(
      (d) =>
        (!platform || d.platform === platform) &&
        (!status || d.status === status),
    );
  }, [data, platform, status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "9px 16px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600 }}>ledger</span>
        <div style={{ width: 1, height: 18, background: "#1d232a" }} />
        <div style={{ display: "flex", gap: 5 }}>
          {["TikTok", "Instagram", "YT Shorts"].map((p) => {
            const active = platform === p;
            return (
              <button
                key={p}
                onClick={() => setPlatform(active ? null : p)}
                style={{
                  fontSize: 11,
                  border: `1px solid ${active ? "#3f4954" : "#2b333c"}`,
                  color: active ? "#eef1f4" : "#9aa1a9",
                  background: active ? "#1a212a" : "transparent",
                  borderRadius: 5,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div style={{ width: 1, height: 18, background: "#1d232a" }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                onClick={() => setStatus(active ? null : s)}
                style={{
                  fontSize: 10.5,
                  fontFamily: "'IBM Plex Mono', monospace",
                  border: `1px solid ${active ? "#3f4954" : "#2b333c"}`,
                  background: active ? "#1a212a" : "transparent",
                  color: "#cfd4da",
                  borderRadius: 4,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#6b727b",
          }}
        >
          {rows.length} distributions
        </span>
      </div>

      <>
        <div
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns:
              "108px minmax(140px,1fr) 92px 100px 70px 116px 130px 64px",
            padding: "7px 16px",
            borderBottom: "1px solid #1d232a",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            letterSpacing: ".07em",
            color: "#59616a",
            background: "#0b0e12",
          }}
        >
          <span>CLIP</span>
          <span>ACCOUNT</span>
          <span>PLATFORM</span>
          <span>STATUS</span>
          <span>SCHED</span>
          <span>UPLOADED</span>
          <span>POST URL</span>
          <span style={{ textAlign: "right" }}>VIEWS</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {rows.map((d) => {
            const pm = personaMeta(d.persona);
            return (
              <div
                key={d.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "108px minmax(140px,1fr) 92px 100px 70px 116px 130px 64px",
                  alignItems: "center",
                  padding: "6px 16px 6px 14px",
                  borderBottom: "1px solid #14181d",
                  borderLeft: `2px solid ${pm.color}`,
                }}
              >
                {/* Styled as a link with cursor:pointer but nothing opened —
                      this screen has no onOpenClip prop. Rendered as plain
                      text until a real navigation handler is wired in. */}
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#9aa1a9",
                  }}
                >
                  {d.clip}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#cfd4da",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.handle}
                </span>
                <span style={{ fontSize: 11, color: "#9aa1a9" }}>
                  {d.platform}
                </span>
                <span>
                  <StatusPill status={d.status} />
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#7d8893",
                  }}
                >
                  {d.sched}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#7d8893",
                  }}
                >
                  {d.up}
                </span>
                {/* Was blue "link-looking" text that was not a link. */}
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    title={d.url}
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#7b93d4",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textDecoration: "none",
                    }}
                  >
                    {d.url}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#515b66",
                    }}
                  >
                    —
                  </span>
                )}
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#9aa1a9",
                  }}
                >
                  {d.viewsK ? d.viewsK + "k" : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </>
    </div>
  );
}
