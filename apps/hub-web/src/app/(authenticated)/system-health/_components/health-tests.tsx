"use client";

import { useState } from "react";

/**
 * Live health tests. Each row fires a REAL round-trip at one dependency via
 * POST /api/health/test and renders pass/fail + latency + detail inline. This
 * is the active complement to the passive "are the keys set?" grid: a present
 * key can still be revoked, rate-limited or pointed at a dead endpoint — only a
 * live call proves the thing works.
 *
 * V2 design: dark, inline styles, var(--v2-accent), material-symbols. The
 * `spin` keyframe comes from v2.css.
 */

const LABEL = "#e5e2e1";
const HINT = "rgba(205,195,215,0.5)";
const CARD_BG = "rgba(255,255,255,0.02)";
const BORDER = "rgba(255,255,255,0.08)";
const GOOD = "#57d38c";
const BAD = "#e0605e";

type Target = "script" | "tts" | "drive" | "telegram" | "redis" | "db";

interface CheckDef {
  target: Target;
  label: string;
  icon: string;
  blurb: string;
}

const CHECKS: CheckDef[] = [
  {
    target: "script",
    label: "Script engine",
    icon: "edit_note",
    blurb: "Tiny DeepSeek completion with the resolved key.",
  },
  {
    target: "tts",
    label: "Voice / TTS",
    icon: "graphic_eq",
    blurb: "Fish Audio auth check (no clip synthesised).",
  },
  {
    target: "drive",
    label: "Delivery (Drive)",
    icon: "cloud_upload",
    blurb: "Mints a token and reads the live Drive quota.",
  },
  {
    target: "telegram",
    label: "Alerts (Telegram)",
    icon: "notifications",
    blurb: "Sends a real test alert to the configured chat.",
  },
  {
    target: "redis",
    label: "Queues (Redis)",
    icon: "lan",
    blurb: "Reads queue metrics across the pipeline.",
  },
  {
    target: "db",
    label: "Database",
    icon: "database",
    blurb: "A trivial select 1 against Postgres.",
  },
];

interface Result {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

type State = Record<
  Target,
  { status: "idle" | "running" | "done"; result?: Result }
>;

function initialState(): State {
  return CHECKS.reduce((acc, c) => {
    acc[c.target] = { status: "idle" };
    return acc;
  }, {} as State);
}

export function HealthTests() {
  const [state, setState] = useState<State>(initialState);
  const [runningAll, setRunningAll] = useState(false);

  async function runOne(target: Target): Promise<void> {
    setState((s) => ({ ...s, [target]: { status: "running" } }));
    let result: Result;
    try {
      const res = await fetch("/api/health/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        result = {
          ok: false,
          latencyMs: 0,
          detail: body.error ?? `HTTP ${res.status}`,
        };
      } else {
        result = (await res.json()) as Result;
      }
    } catch (e) {
      result = {
        ok: false,
        latencyMs: 0,
        detail: e instanceof Error ? e.message : "request failed",
      };
    }
    setState((s) => ({ ...s, [target]: { status: "done", result } }));
  }

  async function runAll(): Promise<void> {
    setRunningAll(true);
    // Sequential: these are real network calls, and serialising keeps latency
    // readings honest (no shared-socket contention) and the UI legible.
    for (const c of CHECKS) {
      await runOne(c.target);
    }
    setRunningAll(false);
  }

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        background: CARD_BG,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={runningAll}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--v2-accent)",
            background: "rgba(var(--v2-accent-rgb), 0.1)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            borderRadius: 6,
            cursor: runningAll ? "default" : "pointer",
            opacity: runningAll ? 0.6 : 1,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              ...(runningAll
                ? { animation: "spin 0.7s linear infinite" }
                : {}),
            }}
          >
            {runningAll ? "progress_activity" : "play_arrow"}
          </span>
          {runningAll ? "Testing…" : "Test all"}
        </button>
      </div>

      {CHECKS.map((c, i) => {
        const entry = state[c.target];
        const running = entry.status === "running";
        const result = entry.result;
        return (
          <div
            key={c.target}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 4px",
              borderTop: i > 0 ? `1px solid ${BORDER}` : "none",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, color: HINT, flexShrink: 0 }}
            >
              {c.icon}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: LABEL }}>
                {c.label}
              </div>
              <div style={{ fontSize: 11, color: HINT }}>
                {running ? "Running…" : result ? renderDetail(result) : c.blurb}
              </div>
            </div>

            {result && !running && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  color: result.ok ? GOOD : BAD,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  {result.ok ? "check_circle" : "cancel"}
                </span>
                {result.latencyMs > 0 ? `${result.latencyMs} ms` : ""}
              </span>
            )}

            <button
              type="button"
              onClick={() => void runOne(c.target)}
              disabled={running || runningAll}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                color: LABEL,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                cursor: running || runningAll ? "default" : "pointer",
                opacity: running || runningAll ? 0.5 : 1,
                flexShrink: 0,
                minWidth: 72,
                justifyContent: "center",
              }}
            >
              {running ? (
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 16,
                    animation: "spin 0.7s linear infinite",
                  }}
                >
                  progress_activity
                </span>
              ) : (
                "Test"
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function renderDetail(result: Result): string {
  return result.detail || (result.ok ? "OK" : "Failed");
}
