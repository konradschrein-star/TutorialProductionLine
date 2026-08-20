"use client";

import { useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

/**
 * Credentials card — the WRITE surface for the ONE secrets area (S8).
 *
 * Rows come from the provider registry catalog joined to encrypted_secrets
 * presence, so the list can never drift into showing phased-out APIs. It SHOWS
 * REALITY: a key present in .env or the DB reads as present, not "no key set".
 * ADMIN only. A secret value is never sent back from the server — only last4.
 */

export interface CredentialRow {
  providerKey: string;
  displayName: string;
  keyEnvVar: string | null;
  source: "db" | "env" | "none";
  last4: string | null;
  expiresAt: string | null;
  costTier: string;
  sortOrder: number;
}

function Badge({ source }: { source: CredentialRow["source"] }) {
  const map = {
    db: { label: "Secrets area", bg: "rgba(90,200,120,0.15)", fg: "#7fd99a" },
    env: { label: ".env fallback", bg: "rgba(230,190,90,0.15)", fg: "#e6be5a" },
    none: { label: "Missing", bg: "rgba(230,120,120,0.15)", fg: "#e57373" },
  } as const;
  const s = map[source];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function CredRow({
  row,
  canManage,
}: {
  row: CredentialRow;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState(row.source);
  const [last4, setLast4] = useState(row.last4);

  async function post(action: string, extra: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, name: row.keyEnvVar, ...extra }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
        return;
      }
      if (action === "set-credential") {
        setSource("db");
        setLast4(value.trim().slice(-4));
        setValue("");
        setEditing(false);
      } else {
        setSource("none");
        setLast4(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 160 }}>
        <div
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--v2-text-1)" }}
        >
          {row.displayName}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--v2-text-2)",
            fontFamily: "monospace",
          }}
        >
          {row.keyEnvVar}
          {row.expiresAt ? ` · expires ${row.expiresAt.slice(0, 10)}` : ""}
          {` · ${row.costTier}`}
        </div>
      </div>
      <Badge source={source} />
      <div
        style={{
          fontSize: 12,
          color: "var(--v2-text-2)",
          fontFamily: "monospace",
          minWidth: 70,
        }}
      >
        {last4 ? `••••${last4}` : "—"}
      </div>
      {canManage && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {editing ? (
            <>
              <input
                type="password"
                placeholder="Paste value…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{
                  background: "var(--v2-surface-2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                  outline: "none",
                  width: 180,
                }}
              />
              <button
                onClick={() => post("set-credential", { value })}
                disabled={busy || !value.trim()}
                style={btn("accent", busy || !value.trim())}
              >
                {busy ? "…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                style={btn("ghost", busy)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                style={btn("ghost", false)}
              >
                {source === "none" ? "Set" : "Rotate"}
              </button>
              {source === "db" && (
                <button
                  onClick={() => post("clear-credential", {})}
                  disabled={busy}
                  style={btn("danger", busy)}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}
      {err && (
        <div style={{ flexBasis: "100%", fontSize: 11, color: "#e57373" }}>
          {err}
        </div>
      )}
    </div>
  );
}

function btn(
  variant: "accent" | "ghost" | "danger",
  disabled: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11.5,
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "1px solid transparent",
  };
  if (variant === "accent")
    return { ...base, background: "var(--v2-accent, #7c6cff)", color: "#fff" };
  if (variant === "danger")
    return {
      ...base,
      background: "transparent",
      color: "#e57373",
      borderColor: "rgba(230,120,120,0.4)",
    };
  return {
    ...base,
    background: "rgba(255,255,255,0.06)",
    color: "var(--v2-text-1)",
  };
}

export function CredentialsCard({
  rows,
  canManage,
}: {
  rows: CredentialRow[];
  canManage: boolean;
}) {
  const withKey = rows.filter((r) => r.keyEnvVar);
  return (
    <GlassCard style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <div
          style={{ fontSize: 14, fontWeight: 800, color: "var(--v2-text-1)" }}
        >
          Credentials
        </div>
        <a
          href="/system-health"
          style={{ fontSize: 11, color: "var(--v2-accent)" }}
        >
          Provider health →
        </a>
      </div>
      <p
        style={{
          fontSize: 11.5,
          color: "var(--v2-text-2)",
          margin: "0 0 12px",
        }}
      >
        The one secrets area. Presence is real — a key set in .env or the
        secrets store reads as present.{" "}
        {canManage
          ? "Set / rotate / clear below (ADMIN only)."
          : "Only an administrator can change these."}
      </p>
      <div>
        {withKey.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
            No credential-bearing providers in the registry.
          </p>
        ) : (
          withKey.map((r) => (
            <CredRow key={r.providerKey} row={r} canManage={canManage} />
          ))
        )}
      </div>
    </GlassCard>
  );
}
