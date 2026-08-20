"use client";

import { useState } from "react";
import { Card } from "../_components/atoms";
import type { CfData } from "../_lib/types";

const STAGE_DEFS = [
  { code: "ING", name: "Ingest", queue: "queue-cf-ingest" },
  { code: "DET", name: "Detection", queue: "queue-cf-clip-detection" },
  { code: "RND", name: "Raw Render", queue: "queue-cf-raw-render" },
  { code: "FIN", name: "Finishing", queue: "" },
  { code: "QC", name: "QC", queue: "" },
  { code: "DST", name: "Distribution", queue: "" },
  { code: "VWS", name: "View Sync", queue: "" },
];

export function PipelineScreen({ data }: { data: CfData }) {
  const [stageIdx, setStageIdx] = useState(0);
  const qDepths = data.queueDepths ?? [];

  const stages = STAGE_DEFS.map((s, i) => {
    const q = qDepths.find((x) => x.name === s.queue);
    let waiting = q?.waiting ?? 0;
    let working = q?.active ?? 0;
    let done = 0;
    let failed = q?.failed ?? 0;

    if (i === 0) {
      done = data.sources.filter(
        (sr) => sr.status === "extracted" || sr.status === "extracting",
      ).length;
    } else if (i === 1) {
      done = data.clips.length;
    } else if (i === 2) {
      done = data.clips.filter((c) => c.status === "pooled").length;
      working += data.clips.filter((c) => c.status === "finishing").length;
    } else if (i === 3) {
      // finishing — no queue yet; show distribution rendered count
      done = data.dists.filter((d) =>
        ["rendered", "qc_pass", "queued", "live"].includes(d.status),
      ).length;
    } else if (i === 4) {
      // QC
      done = data.dists.filter((d) => d.status === "qc_pass").length;
      working = data.dists.filter((d) => d.status === "qc_flag").length;
    } else if (i === 5) {
      done = data.dists.filter((d) => d.status === "live").length;
      failed += data.dists.filter((d) => d.status === "failed").length;
    } else if (i === 6) {
      done = data.dists.filter((d) => d.viewsK > 0).length;
    }

    const total = waiting + working + done + failed || 1;
    return {
      code: s.code,
      name: s.name,
      queue: s.queue,
      waiting,
      working,
      done,
      failed,
      wbar: ((waiting / total) * 100).toFixed(0) + "%",
      kbar: ((working / total) * 100).toFixed(0) + "%",
      fbar: ((failed / total) * 100).toFixed(0) + "%",
      hangBadge: 0,
      arrow: i < STAGE_DEFS.length - 1,
    };
  });

  const stage = stages[stageIdx];

  // Jobs list for the selected stage — derive from the underlying rows.
  let jobs: Array<{
    corr: string;
    clip: string;
    worker: string;
    status: string;
  }> = [];
  if (stageIdx === 0) {
    jobs = data.sources
      .filter((s) => s.status === "ingested" || s.status === "extracting")
      .slice(0, 12)
      .map((s) => ({
        corr: s.id,
        clip: s.title.slice(0, 38),
        worker: "cf-ingest",
        status: s.status,
      }));
  } else if (stageIdx === 1) {
    jobs = data.sources
      .filter((s) => s.status === "extracting")
      .slice(0, 12)
      .map((s) => ({
        corr: s.id,
        clip: s.title.slice(0, 38),
        worker: "cf-clip-detection",
        status: "detecting",
      }));
  } else if (stageIdx === 2) {
    jobs = data.clips
      .filter((c) => c.status === "finishing" || c.status === "classified")
      .slice(0, 12)
      .map((c) => ({
        corr: c.id,
        clip: c.reason.slice(0, 38) || c.id,
        worker: "cf-raw-render",
        status: c.status,
      }));
  } else if (stageIdx === 4) {
    jobs = data.dists
      .filter((d) => d.status === "qc_flag")
      .slice(0, 12)
      .map((d) => ({
        corr: d.id,
        clip: d.clip,
        worker: "qc",
        status: "qc_flag",
      }));
  } else if (stageIdx === 5) {
    jobs = data.dists
      .filter((d) =>
        ["queued", "uploaded", "live", "failed"].includes(d.status),
      )
      .slice(0, 12)
      .map((d) => ({
        corr: d.id,
        clip: d.clip,
        worker: "upload",
        status: d.status,
      }));
  }

  return (
    <div style={{ padding: "14px 16px 26px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          marginBottom: 14,
        }}
      >
        {stages.map((s, i) => {
          const active = i === stageIdx;
          return (
            <div
              key={s.code}
              style={{ display: "flex", alignItems: "stretch", flex: 1 }}
            >
              <button
                onClick={() => setStageIdx(i)}
                style={{
                  flex: 1,
                  border: `1px solid ${active ? "#3a444f" : "#1d232a"}`,
                  borderRadius: 7,
                  background: active ? "#13181f" : "#0e1217",
                  padding: "11px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  color: "#dfe3e8",
                  fontFamily: "inherit",
                }}
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
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      letterSpacing: ".08em",
                      color: "#828a93",
                    }}
                  >
                    {s.code}
                  </span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "#7b848e" }} title="waiting">
                    ◴{s.waiting}
                  </span>
                  <span style={{ color: "#7b93d4" }} title="working">
                    ▶{s.working}
                  </span>
                  <span style={{ color: "#57a578" }} title="done">
                    ✓{s.done}
                  </span>
                  <span style={{ color: "#cf7468" }} title="failed">
                    ✕{s.failed}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    height: 5,
                    borderRadius: 3,
                    overflow: "hidden",
                    background: "#171c22",
                  }}
                >
                  <div style={{ width: s.wbar, background: "#3a424b" }} />
                  <div style={{ width: s.kbar, background: "#7b93d4" }} />
                  <div style={{ width: s.fbar, background: "#cf7468" }} />
                </div>
              </button>
              {s.arrow && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    color: "#2e353d",
                    fontSize: 14,
                    padding: "0 2px",
                  }}
                >
                  ›
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12 }}
      >
        <Card pad={0} style={{ overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "10px 14px",
              borderBottom: "1px solid #1d232a",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              Active Jobs · {stage.name}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 9.5,
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              click stage above to switch
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr 130px 100px",
              padding: "7px 14px",
              borderBottom: "1px solid #1d232a",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              letterSpacing: ".08em",
              color: "#59616a",
            }}
          >
            <span>CORRELATION</span>
            <span>LABEL</span>
            <span>WORKER</span>
            <span>STATUS</span>
          </div>
          {jobs.length === 0 ? (
            <div
              style={{
                padding: "26px 14px",
                textAlign: "center",
                color: "#59616a",
                fontSize: 11,
              }}
            >
              no active rows at this stage
            </div>
          ) : (
            jobs.map((j) => (
              <div
                key={j.corr}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px 1fr 130px 100px",
                  alignItems: "center",
                  padding: "7px 14px",
                  borderBottom: "1px solid #14181d",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#9aa1a9",
                  }}
                >
                  {j.corr}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: "#cfd4da",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {j.clip}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#7d8893",
                  }}
                >
                  {j.worker}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#7b93d4",
                  }}
                >
                  {j.status}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card pad={0} style={{ overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid #1d232a",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            BullMQ Queue Depth
          </div>
          {(data.queueDepths ?? []).map((q) => (
            <div
              key={q.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderBottom: "1px solid #14181d",
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: "#aeb4bb",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {q.name}
              </span>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#7d8893",
                }}
              >
                <span title="waiting">◴{q.waiting}</span>
                <span title="active" style={{ color: "#7b93d4" }}>
                  ▶{q.active}
                </span>
                <span title="delayed">d{q.delayed}</span>
                <span title="failed" style={{ color: "#cf7468" }}>
                  ✕{q.failed}
                </span>
              </div>
            </div>
          ))}
          {(data.queueDepths ?? []).length === 0 && (
            <div
              style={{
                padding: "16px 14px",
                color: "#59616a",
                fontSize: 11,
                textAlign: "center",
              }}
            >
              waiting for first poll…
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
