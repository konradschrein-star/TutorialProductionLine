"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PersonaChip } from "../_components/atoms";
import type { CfData, CfDist } from "../_lib/types";
import { personaMeta } from "../_lib/display";

/**
 * A single automated QC check as stored on `cf_distributions.qc_report`.
 *
 * There is no automated QC engine in Clip Forge today — nothing writes this
 * column except a human verdict from this screen. This surface therefore
 * renders whatever a future engine stores and says so plainly when the report
 * is absent.
 *
 * It used to render seven "checks" whose pass/fail came from
 * `((cur.id.length + i) * 13) % 10 < 3` — arithmetic on the length of the row's
 * UUID — next to a rules table with hardcoded pass rates (71/82/88/94/96/99 %)
 * and the claim that safe-zone overlap "accounts for 41% of all review flags
 * this week". None of it was measured.
 */
interface QcCheck {
  name: string;
  kind: "tech" | "content";
  result: "pass" | "flag" | "fail";
}

function readChecks(report: Record<string, unknown> | null): QcCheck[] {
  const raw = report?.["checks"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is QcCheck =>
      !!c &&
      typeof c === "object" &&
      typeof (c as QcCheck).name === "string" &&
      ["pass", "flag", "fail"].includes((c as QcCheck).result),
  );
}

export function QcScreen({
  data,
  persona,
  onChange,
}: {
  data: CfData;
  persona: string;
  onChange: () => void;
}) {
  const flagged = useMemo(
    () =>
      data.dists.filter(
        (d) =>
          d.status === "qc_flag" &&
          (persona === "All personas" || d.persona === persona),
      ),
    [data, persona],
  );
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const cur = flagged[idx];

  /**
   * Persist the verdict. This used to write to a local `useState` map that
   * was discarded on unmount, while the buttons were labelled with the exact
   * DB states ("approve → qc_pass") they were not setting.
   */
  const decide = useCallback(
    async (dist: CfDist | undefined, verdict: "pass" | "fail") => {
      if (!dist || busy) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const res = await fetch(
          `/api/v1/clip-forge/distributions/${dist.fullId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qc: verdict }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setActionMsg(
          verdict === "pass" ? "Marked qc_pass." : "Marked qc_fail.",
        );
        setIdx((i) => Math.max(0, Math.min(flagged.length - 2, i)));
        onChange();
      } catch (e) {
        setActionMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, flagged.length, onChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const k = e.key.toLowerCase();
      if (k === "a" && cur) {
        e.preventDefault();
        void decide(cur, "pass");
      } else if (k === "r" && cur) {
        e.preventDefault();
        void decide(cur, "fail");
      } else if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(flagged.length - 1, i + 1));
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, flagged, decide]);

  const checks = cur ? readChecks(cur.qcReport) : [];
  const flagCount = checks.filter((c) => c.result !== "pass").length;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        style={{
          width: 262,
          flex: "0 0 262px",
          borderRight: "1px solid #1d232a",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: "1px solid #1d232a",
            background: "#0b0e12",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600 }}>Review Queue</span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#b388c9",
            }}
          >
            {/* Verdicts now persist, so a decided row leaves qc_flag on the
                next poll and the queue length IS the open count. */}
            {flagged.length} open
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {flagged.map((d, i) => {
            const pm = personaMeta(d.persona);
            const active = i === idx;
            return (
              <div
                key={d.id}
                onClick={() => setIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 13px 8px 11px",
                  borderBottom: "1px solid #14181d",
                  borderLeft: `2px solid ${active ? "#dfe3e8" : pm.color}`,
                  cursor: "pointer",
                  background: active ? "#13181f" : "transparent",
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    color: "#59616a",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {d.clip}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      color: "#6b727b",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {d.handle}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    color: "#59616a",
                  }}
                >
                  {/* Age in queue used to be `(i % 6) + 1`h — the row index,
                      rendered as hours. cf_distributions has no queued-at
                      column, so nothing honest can go here yet. */}
                  {d.sched}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {cur ? (
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 18,
              display: "flex",
              gap: 20,
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 172,
                  height: 306,
                  borderRadius: 8,
                  backgroundImage:
                    "repeating-linear-gradient(135deg,#171c23 0 7px,#12161c 7px 14px)",
                  border: "1px solid #232a32",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "16px solid #4a545f",
                    borderTop: "11px solid transparent",
                    borderBottom: "11px solid transparent",
                    marginLeft: 5,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 9,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 8.5,
                    color: "#7d8893",
                  }}
                >
                  {cur.platform}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#59616a",
                }}
              >
                {idx + 1} / {flagged.length}
              </span>
            </div>

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#eef1f4",
                  }}
                >
                  {cur.clip}
                </span>
                <PersonaChip name={cur.persona} size={20} />
                <span style={{ fontSize: 11, color: "#9aa1a9" }}>
                  {cur.handle} · {cur.platform}
                </span>
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "#b388c9",
                    background: "#b388c91c",
                    padding: "3px 9px",
                    borderRadius: 4,
                  }}
                >
                  {flagCount} flag(s)
                </span>
              </div>

              <div
                style={{
                  border: "1px solid #463a52",
                  borderLeft: "3px solid #b388c9",
                  borderRadius: 6,
                  background: "rgba(179,136,201,.07)",
                  padding: "9px 13px",
                  fontSize: 12.5,
                  color: "#cbb8d6",
                }}
              >
                {checks.find((c) => c.result !== "pass")?.name ??
                  "This distribution is flagged for manual review."}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    letterSpacing: ".12em",
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                    marginBottom: 9,
                  }}
                >
                  QC REPORT · AUTOMATED CHECKS
                </div>
                {checks.length === 0 ? (
                  <div
                    style={{
                      border: "1px solid #1d232a",
                      borderRadius: 6,
                      background: "#0e1217",
                      padding: "12px 13px",
                      fontSize: 12,
                      color: "#7d8893",
                      lineHeight: 1.5,
                    }}
                  >
                    No automated QC report is stored for this distribution. Clip
                    Forge has no automated QC engine yet — this panel renders
                    `cf_distributions.qc_report` when one writes it.
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 5 }}
                  >
                    {checks.map((c) => {
                      const col = c.result === "pass" ? "#57a578" : "#b388c9";
                      return (
                        <div
                          key={c.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 11,
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
                              background: col,
                              flex: "0 0 auto",
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12,
                              color: "#cfd4da",
                            }}
                          >
                            {c.name}
                          </span>
                          {c.kind && (
                            <span
                              style={{
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 9,
                                color: "#59616a",
                                border: "1px solid #2b333c",
                                borderRadius: 3,
                                padding: "1px 6px",
                              }}
                            >
                              {c.kind}
                            </span>
                          )}
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: 10,
                              color: col,
                              background: col + "22",
                              padding: "2px 8px",
                              borderRadius: 3,
                              width: 42,
                              textAlign: "center",
                            }}
                          >
                            {c.result}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 18px",
              borderTop: "1px solid #1d232a",
              background: "#0b0e12",
            }}
          >
            {/* "re-render" and "open in studio" used to sit here as
                `action: () => {}` — buttons that did nothing at all. Removed;
                both are reachable from the Inspector, which owns variants. */}
            {[
              {
                label: "approve → qc_pass",
                k: "A",
                bg: "rgba(87,165,120,.12)",
                border: "#2c5e42",
                color: "#7fc79b",
                action: () => void decide(cur, "pass"),
              },
              {
                label: "reject → qc_fail",
                k: "R",
                bg: "rgba(207,116,104,.1)",
                border: "#5a4046",
                color: "#dd8d83",
                action: () => void decide(cur, "fail"),
              },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.action}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: `1px solid ${b.border}`,
                  background: b.bg,
                  color: b.color,
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                {b.label}
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    border: `1px solid ${b.border}`,
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  {b.k}
                </span>
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#59616a",
              }}
            >
              J/K or ↑↓ to move · keyboard-first triage
            </span>
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#59616a",
            fontSize: 13,
          }}
        >
          Review queue is clear — no flagged clips.
        </div>
      )}

      {/* The right rail used to show an "ACTIVE QC RULES · PASS RATE" table with
          six hardcoded pass rates (71/82/88/94/96/99 %) and a "MOST-FLAGGING
          CHECK" card asserting that caption/safe-zone overlap "accounts for 41%
          of all review flags this week". No QC engine exists and none of those
          numbers were measured, so the whole rail is gone. It comes back when
          something actually writes cf_distributions.qc_report. */}
    </div>
  );
}
