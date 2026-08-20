"use client";

import { useEffect, useState } from "react";
import { cfApi, type CfApiPersona } from "../_lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type Platform = "tiktok" | "instagram" | "youtube_shorts";
const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube_shorts", label: "YT Shorts" },
];

export function AddAccountModal({ open, onClose, onCreated }: Props) {
  const [personas, setPersonas] = useState<CfApiPersona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [handle, setHandle] = useState("");
  const [proxyEndpoint, setProxyEndpoint] = useState("");
  const [profileId, setProfileId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    cfApi
      .listPersonas()
      .then((r) => {
        setPersonas(r.personas);
        if (r.personas.length > 0 && !personaId) setPersonaId(r.personas[0].id);
      })
      .catch((e) =>
        setError("Could not load personas: " + (e as Error).message),
      );
  }, [open]);

  if (!open) return null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/clip-forge/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona_id: personaId,
          platform,
          handle: handle.trim(),
          proxy_endpoint: proxyEndpoint.trim() || undefined,
          browser_profile_id: profileId.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      setHandle("");
      setProxyEndpoint("");
      setProfileId("");
      onCreated?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,6,8,.62)",
        backdropFilter: "blur(2px)",
        zIndex: 70,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "92vw",
          background: "#0e1217",
          border: "1px solid #2b333c",
          borderRadius: 10,
          padding: 18,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 14 }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Add an account</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              color: "#7d8893",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <Field label="PERSONA">
          {personas.length === 0 ? (
            <div style={{ fontSize: 11, color: "#9b8aa8" }}>
              Create a persona first via Sources → + add source.
            </div>
          ) : (
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              style={baseInput}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="PLATFORM">
          <div
            style={{
              display: "flex",
              border: "1px solid #2b333c",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {PLATFORMS.map((p, i) => {
              const active = platform === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  style={{
                    border: 0,
                    borderLeft: i > 0 ? "1px solid #2b333c" : 0,
                    background: active ? "#1a212a" : "transparent",
                    color: active ? "#eef1f4" : "#7d8893",
                    padding: "5px 13px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 11,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="HANDLE">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@marc.clips"
            style={baseInput}
          />
        </Field>

        <Field label="PROXY ENDPOINT (optional)">
          <input
            value={proxyEndpoint}
            onChange={(e) => setProxyEndpoint(e.target.value)}
            placeholder="10.4.21.7:1080"
            style={baseInput}
          />
        </Field>

        <Field label="BROWSER PROFILE ID (optional)">
          <input
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="prof_12345"
            style={baseInput}
          />
        </Field>

        {error && (
          <div
            style={{
              fontSize: 11.5,
              color: "#dd8d83",
              background: "rgba(207,116,104,.08)",
              border: "1px solid #5a4046",
              borderRadius: 6,
              padding: "9px 11px",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #2b333c",
              background: "transparent",
              color: "#aeb4bb",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            cancel
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={submit}
            disabled={submitting || !personaId || !handle.trim()}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 6,
              padding: "8px 18px",
              cursor: submitting ? "wait" : "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              opacity: !personaId || !handle.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? "creating…" : "create →"}
          </button>
        </div>
      </div>
    </div>
  );
}

const baseInput: React.CSSProperties = {
  width: "100%",
  background: "#10141a",
  border: "1px solid #232a32",
  borderRadius: 6,
  color: "#e6e9ed",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "7px 10px",
  outline: "none",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: ".12em",
          color: "#59616a",
          fontFamily: "'IBM Plex Mono', monospace",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
