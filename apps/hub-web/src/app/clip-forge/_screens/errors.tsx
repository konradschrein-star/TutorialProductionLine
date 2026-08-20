"use client";

import { useMemo, useState } from "react";
import { PersonaChip } from "../_components/atoms";
import type { CfData, CfError } from "../_lib/types";

const CLASS_COLORS: Record<CfError["cls"], string> = {
  transient: "#7b93d4",
  resource: "#b388c9",
  data: "#7b848e",
  platform: "#cf7468",
  logic: "#cbb8d6",
};

// Error-class totals and queue backlog are derived from live data. The
// selected failure's payload and stacktrace are the ones actually stored on
// cf_job_failures — they used to be hardcoded literals (a fixed queue name,
// a fixed variantSeed, and three stack frames pointing at a file that does
// not exist), rendered identically for every failure.

export function ErrorsScreen({
  data,
  onChange,
}: {
  data: CfData;
  onChange: () => void;
}) {
  const [cls, setCls] = useState<CfError["cls"] | null>(null);
  const [layer, setLayer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  /** Requeue or discard a dead-lettered job, then refresh the ledger. */
  async function act(failureId: string, kind: "requeue" | "discard") {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/v1/clip-forge/job-failures/${failureId}`, {
        method: kind === "requeue" ? "POST" : "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setActionMsg(kind === "requeue" ? "Requeued." : "Discarded.");
      onChange();
    } catch (e) {
      setActionMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  const filtered = useMemo(() => {
    return data.errors.filter(
      (e) => (!cls || e.cls === cls) && (!layer || e.layer === layer),
    );
  }, [data, cls, layer]);
  const dlqCount = data.errors.filter((e) => e.dlq).length;
  const [selId, setSelId] = useState<string>(data.errors[0]?.id ?? "");
  const sel = data.errors.find((e) => e.id === selId);

  const flaggedAccounts = data.accounts.filter((a) => a.flag).slice(0, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {flaggedAccounts.length > 0 && (
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "9px 16px",
            borderBottom: "1px solid #4a3038",
            background: "rgba(207,116,104,.07)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#cf7468",
              animation: "cf-blink 1.3s infinite",
              flex: "0 0 auto",
            }}
          />
          <span style={{ fontWeight: 600, color: "#dd8d83", fontSize: 12 }}>
            Accounts auto-disabled by platform errors
          </span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {flaggedAccounts.map((a) => (
              <span
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  color: "#cfd4da",
                  border: "1px solid #4a3038",
                  borderRadius: 4,
                  padding: "2px 8px",
                }}
              >
                <PersonaChip name={a.persona} size={14} />
                {a.handle}
                <span style={{ color: "#6b727b" }}>· {a.platform}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 16px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(
            ["transient", "resource", "data", "platform", "logic"] as const
          ).map((c) => {
            const active = cls === c;
            return (
              <button
                key={c}
                onClick={() => setCls(active ? null : c)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
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
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: CLASS_COLORS[c],
                  }}
                />
                {c}
              </button>
            );
          })}
        </div>
        <div style={{ width: 1, height: 18, background: "#1d232a" }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[
            "Ingest",
            "Extraction",
            "Classification",
            "Finishing",
            "QC",
            "Distribution",
            "View-Sync",
          ].map((l) => {
            const active = layer === l;
            return (
              <button
                key={l}
                onClick={() => setLayer(active ? null : l)}
                style={{
                  fontSize: 10.5,
                  fontFamily: "'IBM Plex Mono', monospace",
                  border: `1px solid ${active ? "#3f4954" : "#2b333c"}`,
                  background: active ? "#1a212a" : "transparent",
                  color: "#9aa1a9",
                  borderRadius: 4,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {l}
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
          {filtered.length} errors ·
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#cf7468",
          }}
        >
          {dlqCount} in DLQ
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "1fr 360px",
        }}
      >
        <div
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #1d232a",
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              display: "grid",
              gridTemplateColumns: "74px 100px 90px 120px 1fr 56px",
              padding: "7px 16px",
              borderBottom: "1px solid #1d232a",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              letterSpacing: ".06em",
              color: "#59616a",
              background: "#0b0e12",
            }}
          >
            <span>TIME</span>
            <span>LAYER</span>
            <span>CLASS</span>
            <span>CORRELATION</span>
            <span>MESSAGE</span>
            <span style={{ textAlign: "right" }}>RETRY</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {filtered.map((e) => {
              const col = CLASS_COLORS[e.cls];
              const active = e.id === selId;
              return (
                <div
                  key={e.id}
                  onClick={() => setSelId(e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "74px 100px 90px 120px 1fr 56px",
                    alignItems: "center",
                    padding: "6px 16px",
                    borderBottom: "1px solid #14181d",
                    cursor: "pointer",
                    background: active ? "#13181f" : "transparent",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#7d8893",
                    }}
                  >
                    {e.ts}
                  </span>
                  <span style={{ fontSize: 11, color: "#9aa1a9" }}>
                    {e.layer}
                  </span>
                  <span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9.5,
                        color: col,
                        background: col + "22",
                        padding: "2px 7px",
                        borderRadius: 3,
                      }}
                    >
                      {e.cls}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#7b93d4",
                    }}
                  >
                    {e.corr}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      paddingRight: 10,
                    }}
                  >
                    {e.msg}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                        color: "#7d8893",
                      }}
                    >
                      {/* retry_count is not stored on cf_job_failures. */}
                      {e.retries < 0 ? "—" : e.retries}
                    </span>
                    {e.dlq && (
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 8,
                          color: "#cf7468",
                          border: "1px solid #5a4046",
                          borderRadius: 3,
                          padding: "0 3px",
                        }}
                      >
                        DLQ
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            minHeight: 0,
            overflow: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {sel && (
            <>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      color: CLASS_COLORS[sel.cls],
                      background: CLASS_COLORS[sel.cls] + "22",
                      padding: "2px 8px",
                      borderRadius: 3,
                    }}
                  >
                    {sel.cls}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#cfd4da",
                    }}
                  >
                    {sel.layer}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#7d8893",
                    }}
                  >
                    {sel.retries < 0 ? "retries n/a" : `retry ${sel.retries}`}
                  </span>
                </div>
                <div
                  style={{ fontSize: 13, color: "#e6e9ed", marginBottom: 4 }}
                >
                  {sel.msg}
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#7b93d4",
                  }}
                >
                  {sel.corr} · {sel.clip}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: ".12em",
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                    marginBottom: 6,
                  }}
                >
                  PAYLOAD
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10.5,
                    color: "#9aa1a9",
                    background: "#0a0d11",
                    border: "1px solid #1d232a",
                    borderRadius: 6,
                    padding: "9px 11px",
                    whiteSpace: "pre",
                    overflow: "auto",
                    lineHeight: 1.5,
                  }}
                >
                  {/* The real cf_job_failures payload. This block used to be a
                      hand-written template literal — a fixed queue name, a
                      fixed "platform": "TikTok" and a fixed variantSeed 2391 —
                      while the actual payload sat unused on the row. Debugging
                      against invented job data is worse than no data. */}
                  {JSON.stringify(
                    {
                      jobId: sel.jobId,
                      queue: sel.queue,
                      correlationId: sel.corr || null,
                      payload: sel.payload,
                    },
                    null,
                    2,
                  )}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: ".12em",
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                    marginBottom: 6,
                  }}
                >
                  LAST ERROR · STACKTRACE
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    background: "#0a0d11",
                    border: "1px solid #1d232a",
                    borderRadius: 6,
                    padding: "9px 11px",
                    overflow: "auto",
                    lineHeight: 1.6,
                  }}
                >
                  {/* Real stored stacktrace. The three frames that used to be
                      printed here (cf-finishing.js:87:23 and friends) were
                      literals — the same "trace" appeared for every failure of
                      every kind, pointing at a file that does not exist. */}
                  {sel.stacktrace ? (
                    sel.stacktrace.split("\n").map((ln, i) => (
                      <div
                        key={i}
                        style={{ color: "#a78b86", whiteSpace: "pre" }}
                      >
                        {ln}
                      </div>
                    ))
                  ) : (
                    <>
                      <div style={{ color: "#a78b86", whiteSpace: "pre" }}>
                        {"Error: " + sel.msg}
                      </div>
                      <div style={{ color: "#59616a", marginTop: 6 }}>
                        No stacktrace was recorded for this failure.
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* These three buttons had no handlers at all: a dead-lettered
                  job could only be recovered by hand on the box. Requeue
                  replays the stored payload onto its original queue; discard
                  drops the record. */}
              <div style={{ display: "flex", gap: 7 }}>
                <button
                  disabled={busy}
                  onClick={() => void act(sel.fullId, "requeue")}
                  style={{
                    flex: 1,
                    border: "1px solid #3f4954",
                    background: "#1a212a",
                    color: busy ? "#7d8893" : "#eef1f4",
                    borderRadius: 6,
                    padding: 7,
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit",
                    fontSize: 11,
                  }}
                >
                  requeue
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act(sel.fullId, "discard")}
                  style={{
                    flex: 1,
                    border: "1px solid #2b333c",
                    background: "transparent",
                    color: "#aeb4bb",
                    borderRadius: 6,
                    padding: 7,
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit",
                    fontSize: 11,
                  }}
                >
                  discard
                </button>
              </div>
              {actionMsg && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: actionMsg.startsWith("Failed")
                      ? "#dd8d83"
                      : "#7fc79b",
                  }}
                >
                  {actionMsg}
                </div>
              )}
            </>
          )}

          <div style={{ borderTop: "1px solid #1d232a", paddingTop: 13 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: ".12em",
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: 9,
              }}
            >
              ERROR CLASS TOTALS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {(() => {
                const cls = [
                  "transient",
                  "resource",
                  "data",
                  "platform",
                  "logic",
                ] as const;
                const counts = cls.map((c) => ({
                  cls: c,
                  total: data.errors.filter((e) => e.cls === c).length,
                }));
                const peak = Math.max(1, ...counts.map((c) => c.total));
                return counts.map((c) => {
                  const col = CLASS_COLORS[c.cls];
                  return (
                    <div
                      key={c.cls}
                      style={{ display: "flex", alignItems: "center", gap: 9 }}
                    >
                      <span
                        style={{
                          width: 66,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: col,
                        }}
                      >
                        {c.cls}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 5,
                          borderRadius: 3,
                          background: "#161b21",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: ((c.total / peak) * 100).toFixed(0) + "%",
                            background: col,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10,
                          color: "#7d8893",
                          width: 24,
                          textAlign: "right",
                        }}
                      >
                        {c.total}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
            {data.errors.length === 0 && (
              <div style={{ fontSize: 10.5, color: "#59616a", marginTop: 10 }}>
                no failures recorded · pipeline clean
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid #1d232a", paddingTop: 13 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: ".12em",
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: 9,
              }}
            >
              QUEUE BACKLOG
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {(data.queueDepths ?? []).map((q) => (
                <div
                  key={q.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 11px",
                    border: "1px solid #1d232a",
                    borderRadius: 6,
                    background: "#0e1217",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: q.failed > 0 ? "#cf7468" : "#57a578",
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 11.5,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {q.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: q.failed > 0 ? "#cf7468" : "#7d8893",
                    }}
                  >
                    ◴{q.waiting} ▶{q.active} ✕{q.failed}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
