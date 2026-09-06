"use client";

import { useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

export interface CredentialRow {
  providerKey: string;
  displayName: string;
  keyEnvVar: string | null;
  source: "db" | "env" | "none";
  last4: string | null;
  expiresAt: string | null;
  costTier: string;
  sortOrder: number;
  kind?: "script" | "tts" | "delivery" | "alerts";
  required?: boolean;
  notNeeded?: boolean;
  description?: string;
  setupUrl?: string;
}

const sourceStyle = {
  db: { label: "Saved here", bg: "rgba(90,200,120,.15)", color: "#7fd99a" },
  env: {
    label: "Server fallback",
    bg: "rgba(230,190,90,.15)",
    color: "#e6be5a",
  },
  none: {
    label: "Not connected",
    bg: "rgba(230,120,120,.15)",
    color: "#e57373",
  },
} as const;

function button(
  variant: "primary" | "plain" | "danger",
  disabled = false,
): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: "6px 10px",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  };
  if (variant === "primary")
    return { ...base, background: "var(--v2-accent)", color: "#071006" };
  if (variant === "danger")
    return {
      ...base,
      background: "transparent",
      color: "#e57373",
      borderColor: "rgba(230,120,120,.35)",
    };
  return {
    ...base,
    background: "rgba(255,255,255,.06)",
    color: "var(--v2-text-1)",
    borderColor: "rgba(255,255,255,.08)",
  };
}

function CredentialEditor({
  row,
  canManage,
}: {
  row: CredentialRow;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [source, setSource] = useState(row.source);
  const [last4, setLast4] = useState(row.last4);
  const badge = sourceStyle[source];
  const testTarget =
    row.kind === "script"
      ? "script"
      : row.kind === "tts"
        ? "tts"
        : row.providerKey.startsWith("google_drive")
          ? "drive"
          : row.kind === "alerts"
            ? "telegram"
            : null;

  async function mutate(action: "set-credential" | "clear-credential") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          name: row.keyEnvVar,
          ...(action === "set-credential" ? { value } : {}),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        source?: CredentialRow["source"];
        last4?: string | null;
      };
      if (!res.ok || !json.ok)
        throw new Error(json.error ?? `HTTP ${res.status}`);
      if (action === "set-credential") {
        setSource(json.source ?? "db");
        setLast4(json.last4 ?? value.trim().slice(-4));
        setValue("");
        setEditing(false);
      } else {
        setSource(json.source ?? "none");
        setLast4(json.last4 ?? null);
      }
      setMessage({
        ok: true,
        text:
          action === "set-credential"
            ? "Saved securely."
            : "Credential removed.",
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!testTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/health/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: testTarget }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      setMessage({
        ok: Boolean(json.ok),
        text: json.detail ?? json.error ?? `HTTP ${res.status}`,
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Test failed",
      });
    } finally {
      setBusy(false);
    }
  }

  function generateToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setValue(
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
    setEditing(true);
  }

  return (
    <div
      style={{
        padding: "11px 12px",
        borderBottom: "1px solid rgba(255,255,255,.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 180 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--v2-text-1)",
            }}
          >
            {row.displayName}
            {row.required && !row.notNeeded && (
              <span style={{ marginLeft: 7, fontSize: 9, color: "#e6b34a" }}>
                REQUIRED
              </span>
            )}
          </div>
          <div
            style={{ marginTop: 2, fontSize: 10.5, color: "var(--v2-text-2)" }}
          >
            {row.description ?? "Provider credential"}
          </div>
          <details style={{ marginTop: 3 }}>
            <summary
              style={{
                cursor: "pointer",
                fontSize: 9.5,
                color: "rgba(205,195,215,.42)",
              }}
            >
              Advanced
            </summary>
            <code style={{ fontSize: 9.5, color: "rgba(205,195,215,.55)" }}>
              {row.keyEnvVar}
            </code>
          </details>
        </div>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            padding: "3px 8px",
            borderRadius: 99,
            background: badge.bg,
            color: badge.color,
          }}
        >
          {badge.label}
        </span>
        <code style={{ minWidth: 66, fontSize: 11, color: "var(--v2-text-2)" }}>
          {last4 ? `••••${last4}` : "—"}
        </code>
        {canManage && !editing && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button style={button("plain")} onClick={() => setEditing(true)}>
              {source === "none" ? "Connect" : "Rotate"}
            </button>
            {row.providerKey === "uploader_callback_secret" &&
              source === "none" && (
                <button style={button("plain")} onClick={generateToken}>
                  Generate
                </button>
              )}
            {source !== "none" && testTarget && (
              <button
                style={button("plain", busy)}
                disabled={busy}
                onClick={test}
              >
                Test
              </button>
            )}
            {row.setupUrl && (
              <a
                style={{ ...button("plain"), textDecoration: "none" }}
                href={row.setupUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open provider ↗
              </a>
            )}
            {source === "db" && (
              <button
                style={button("danger", busy)}
                disabled={busy}
                onClick={() => mutate("clear-credential")}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div
          style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}
        >
          <input
            autoFocus
            type="password"
            value={value}
            placeholder="Paste the credential value"
            onChange={(e) => setValue(e.target.value)}
            style={{
              flex: "1 1 280px",
              padding: "7px 9px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,.12)",
              background: "var(--v2-surface-2)",
              color: "var(--v2-text-1)",
              fontSize: 12,
            }}
          />
          <button
            style={button("primary", busy || !value.trim())}
            disabled={busy || !value.trim()}
            onClick={() => mutate("set-credential")}
          >
            {busy ? "Saving…" : "Save securely"}
          </button>
          <button
            style={button("plain", busy)}
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {message && (
        <div
          style={{
            marginTop: 7,
            fontSize: 10.5,
            color: message.ok ? "#7fd99a" : "#e57373",
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

export function CredentialsCard({
  rows,
  canManage,
}: {
  rows: CredentialRow[];
  canManage: boolean;
}) {
  const visible = rows.filter((r) => r.keyEnvVar);
  const required = visible.filter((r) => r.required && !r.notNeeded);
  const ready = required.filter((r) => r.source !== "none").length;
  const groups: Array<{
    key: NonNullable<CredentialRow["kind"]>;
    label: string;
    hint: string;
  }> = [
    {
      key: "script",
      label: "Writing & metadata",
      hint: "Scripts, titles, descriptions, tags and translations",
    },
    { key: "tts", label: "Voices", hint: "Narration and localized audio" },
    {
      key: "delivery",
      label: "Delivery & uploader",
      hint: "Google Drive and the separate uploader",
    },
    {
      key: "alerts",
      label: "Alerts",
      hint: "Optional operational notifications",
    },
  ];

  return (
    <GlassCard style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <div
          style={{ fontSize: 14, fontWeight: 800, color: "var(--v2-text-1)" }}
        >
          Connections & API keys
        </div>
        <a
          href="/system-health"
          style={{ fontSize: 11, color: "var(--v2-accent)" }}
        >
          System health →
        </a>
      </div>
      <p
        style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--v2-text-2)" }}
      >
        Change providers here without editing server files. Values are encrypted
        and are never shown again after saving.
      </p>
      <div
        style={{
          margin: "12px 0",
          padding: 12,
          borderRadius: 8,
          background:
            ready === required.length
              ? "rgba(90,200,120,.08)"
              : "rgba(230,179,74,.07)",
          border: `1px solid ${ready === required.length ? "rgba(90,200,120,.25)" : "rgba(230,179,74,.25)"}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11.5,
            fontWeight: 800,
            color: "var(--v2-text-1)",
          }}
        >
          <span>Handoff readiness</span>
          <span>
            {ready} / {required.length} required
          </span>
        </div>
        <div
          style={{
            height: 5,
            borderRadius: 99,
            background: "rgba(255,255,255,.07)",
            marginTop: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${required.length ? (ready / required.length) * 100 : 100}%`,
              height: "100%",
              background: ready === required.length ? "#57d38c" : "#e6b34a",
            }}
          />
        </div>
      </div>
      {groups.map((group) => {
        const main = visible.filter(
          (r) => r.kind === group.key && !r.notNeeded,
        );
        const fallback = visible.filter(
          (r) => r.kind === group.key && r.notNeeded,
        );
        if (!main.length && !fallback.length) return null;
        return (
          <section key={group.key} style={{ marginTop: 15 }}>
            <div style={{ padding: "0 4px 7px" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "var(--v2-text-1)",
                }}
              >
                {group.label}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--v2-text-2)" }}>
                {group.hint}
              </div>
            </div>
            {main.length > 0 && (
              <div
                style={{
                  border: "1px solid rgba(255,255,255,.07)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {main.map((row) => (
                  <CredentialEditor
                    key={row.providerKey}
                    row={row}
                    canManage={canManage}
                  />
                ))}
              </div>
            )}
            {fallback.length > 0 && (
              <details style={{ marginTop: 7 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 10.5,
                    color: "var(--v2-text-2)",
                  }}
                >
                  Optional fallback providers ({fallback.length})
                </summary>
                <div
                  style={{
                    marginTop: 6,
                    border: "1px solid rgba(255,255,255,.07)",
                    borderRadius: 8,
                    overflow: "hidden",
                    opacity: 0.75,
                  }}
                >
                  {fallback.map((row) => (
                    <CredentialEditor
                      key={row.providerKey}
                      row={row}
                      canManage={canManage}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </GlassCard>
  );
}
