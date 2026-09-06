"use client";

import { useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

type Check = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  href: string;
};
type Probe = { ok: boolean; detail: string; latencyMs?: number };

export function SetupReadinessCard({ checks }: { checks: Check[] }) {
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [running, setRunning] = useState(false);
  const ready = checks.filter((c) => c.ready).length;

  async function runChecks() {
    setRunning(true);
    setProbes({});
    for (const target of [
      "db",
      "redis",
      "script",
      "tts",
      "drive",
      "uploader",
    ]) {
      try {
        const response = await fetch("/api/health/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target }),
        });
        const result = (await response.json()) as Probe & { error?: string };
        setProbes((p) => ({
          ...p,
          [target]: {
            ok: Boolean(result.ok),
            detail: result.detail ?? result.error ?? `HTTP ${response.status}`,
            latencyMs: result.latencyMs,
          },
        }));
      } catch (error) {
        setProbes((p) => ({
          ...p,
          [target]: {
            ok: false,
            detail: error instanceof Error ? error.message : "Check failed",
          },
        }));
      }
    }
    setRunning(false);
  }

  return (
    <GlassCard style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 800, color: "var(--v2-text-1)" }}
          >
            Handoff checklist
          </div>
          <div
            style={{ marginTop: 3, fontSize: 10.5, color: "var(--v2-text-2)" }}
          >
            Everything your friend should be able to maintain from this console.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              fontSize: 11,
              color: ready === checks.length ? "#7fd99a" : "#e6b34a",
              fontWeight: 800,
            }}
          >
            {ready}/{checks.length} configured
          </span>
          <button
            onClick={runChecks}
            disabled={running}
            style={{
              padding: "7px 11px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(255,255,255,.06)",
              color: "var(--v2-text-1)",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {running ? "Checking…" : "Test all connections"}
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
          gap: 8,
          marginTop: 12,
        }}
      >
        {checks.map((check) => (
          <a
            key={check.id}
            href={check.href}
            style={{
              textDecoration: "none",
              padding: 10,
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,.07)",
              background: "rgba(255,255,255,.02)",
            }}
          >
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <span
                style={{
                  color: check.ready ? "#7fd99a" : "#e6b34a",
                  fontSize: 12,
                }}
              >
                {check.ready ? "●" : "○"}
              </span>
              <span
                style={{
                  color: "var(--v2-text-1)",
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                {check.label}
              </span>
            </div>
            <div
              style={{
                color: "var(--v2-text-2)",
                fontSize: 10,
                margin: "4px 0 0 19px",
              }}
            >
              {check.detail}
            </div>
          </a>
        ))}
      </div>
      {Object.keys(probes).length > 0 && (
        <div
          style={{
            marginTop: 12,
            borderTop: "1px solid rgba(255,255,255,.07)",
            paddingTop: 9,
            display: "flex",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(probes).map(([name, result]) => (
            <span
              key={name}
              title={result.detail}
              style={{
                fontSize: 10,
                padding: "4px 7px",
                borderRadius: 99,
                color: result.ok ? "#7fd99a" : "#e57373",
                background: result.ok
                  ? "rgba(90,200,120,.1)"
                  : "rgba(230,120,120,.1)",
              }}
            >
              {name}: {result.ok ? "OK" : "failed"}
              {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""}
            </span>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
