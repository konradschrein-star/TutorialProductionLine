"use client";

import { useEffect, useState } from "react";

/**
 * Read-only Google Drive archive status. V2 inline styles only (no Tailwind,
 * no lucide, no native <select>). Reads GET /api/storage/drive/health — the
 * seam owned by @repo/storage — and shows REAL numbers: daily byte budget
 * used/remaining, artefacts by state, last successful upload, the 750 GB
 * ceiling. No fabricated values.
 *
 * consentPublishingStatus === "testing" renders as a WARNING: a Testing consent
 * screen revokes the refresh token after 7 days (the silent time-bomb).
 */

interface DriveHealth {
  configured: boolean;
  enabled: boolean;
  reason: string | null;
  tokenValid: boolean | null;
  consentPublishingStatus: "production" | "testing" | "unknown";
  quotaBytesTotal: number | null;
  quotaBytesUsed: number | null;
  dailyBudgetBytes: number;
  dailyBudgetUsedBytes: number;
  artifactsByState: Record<string, number>;
  lastSuccessfulUploadAt: string | null;
  lastError: { kind: string; message: string; at: string } | null;
  checkedAt: string;
}

const LABEL = "#e5e2e1";
const HINT = "rgba(205,195,215,0.5)";
const CARD_BG = "rgba(255,255,255,0.02)";
const BORDER = "rgba(255,255,255,0.08)";
const GOOD = "#57d38c";
const WARN = "#e6b34a";
const BAD = "#e0605e";

const DRIVE_DAILY_CEILING = 750 * 1024 * 1024 * 1024;

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso: string | null): string {
  if (iso === null) return "never";
  return new Date(iso).toLocaleString();
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        marginRight: 8,
        flexShrink: 0,
      }}
    />
  );
}

export function DriveArchiveCard() {
  const [health, setHealth] = useState<DriveHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/storage/drive/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DriveHealth) => {
        if (alive) {
          setHealth(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "failed to load");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const budgetPct =
    health && health.dailyBudgetBytes > 0
      ? Math.min(100, (health.dailyBudgetUsedBytes / health.dailyBudgetBytes) * 100)
      : 0;

  const statusColor = !health
    ? HINT
    : !health.enabled
      ? HINT
      : health.consentPublishingStatus === "testing"
        ? WARN
        : health.tokenValid === false
          ? BAD
          : GOOD;

  const statusLabel = !health
    ? "…"
    : !health.enabled
      ? "Disabled"
      : health.consentPublishingStatus === "testing"
        ? "Testing consent — token expires in 7 days"
        : health.tokenValid === false
          ? "Auth failing"
          : "Enabled";

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        background: CARD_BG,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginTop: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <Dot color={statusColor} />
        <span style={{ fontSize: 13, fontWeight: 600, color: LABEL }}>
          Google Drive archive
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {loading && (
        <p style={{ fontSize: 12, color: HINT, margin: 0 }}>Loading…</p>
      )}

      {error !== null && (
        <p style={{ fontSize: 12, color: BAD, margin: 0 }}>
          Could not load Drive health: {error}
        </p>
      )}

      {health && !health.enabled && (
        <p style={{ fontSize: 12, color: HINT, margin: 0 }}>
          {health.reason ?? "Not configured."}
        </p>
      )}

      {health && health.enabled && (
        <>
          {/* Daily byte budget */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: LABEL,
                marginBottom: 4,
              }}
            >
              <span>Daily upload budget</span>
              <span style={{ color: HINT }}>
                {fmtBytes(health.dailyBudgetUsedBytes)} /{" "}
                {fmtBytes(health.dailyBudgetBytes)}
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "rgba(255,255,255,0.06)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${budgetPct}%`,
                  height: "100%",
                  background: budgetPct > 90 ? WARN : GOOD,
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: HINT, margin: "4px 0 0" }}>
              Google&apos;s hard ceiling is {fmtBytes(DRIVE_DAILY_CEILING)}{" "}
              uploaded/day — the binding limit is volume, not request count.
            </p>
          </div>

          {/* Artefacts by state */}
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}
          >
            {Object.entries(health.artifactsByState).map(([state, count]) => (
              <span key={state} style={{ color: LABEL }}>
                <span style={{ color: HINT }}>{state}:</span> {count}
              </span>
            ))}
            {Object.keys(health.artifactsByState).length === 0 && (
              <span style={{ color: HINT }}>no artefacts recorded yet</span>
            )}
          </div>

          <div style={{ fontSize: 12, color: HINT }}>
            Last successful upload: {fmtDate(health.lastSuccessfulUploadAt)}
          </div>

          {health.quotaBytesTotal !== null && (
            <div style={{ fontSize: 12, color: HINT }}>
              Drive storage: {fmtBytes(health.quotaBytesUsed)} /{" "}
              {fmtBytes(health.quotaBytesTotal)}
            </div>
          )}

          {health.lastError !== null && (
            <div style={{ fontSize: 12, color: BAD }}>
              Last error ({health.lastError.kind}): {health.lastError.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
