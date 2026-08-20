"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ScriptInjectionPanelProps {
  jobId: string;
}

export function ScriptInjectionPanel({ jobId }: ScriptInjectionPanelProps) {
  const router = useRouter();
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!script.trim() || script.trim().length < 10) {
      setError("Script must be at least 10 characters");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: script.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to inject script");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: "var(--v2-accent)" }}
        >
          edit_note
        </span>
        <h3
          style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e5e2e1" }}
        >
          Inject Script
        </h3>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "rgba(205,195,215,0.5)",
            marginLeft: "auto",
          }}
        >
          SCRIPTING
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "rgba(205,195,215,0.6)" }}>
        Paste a script below to skip AI generation and proceed directly to asset
        collection.
      </p>

      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder="Paste the script here..."
        rows={12}
        style={{
          width: "100%",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
          borderRadius: 6,
          padding: "10px 12px",
          color: "#e5e2e1",
          fontSize: 13,
          fontFamily: "monospace",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {error && (
        <p style={{ margin: 0, fontSize: 12, color: "#ef4444" }}>{error}</p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={loading || !script.trim()}
          className="v2-btn"
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            opacity: loading || !script.trim() ? 0.5 : 1,
            cursor: loading || !script.trim() ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Submitting…" : "Submit Script"}
        </button>
        <span style={{ fontSize: 11, color: "rgba(205,195,215,0.4)" }}>
          {script.length > 0
            ? `${script.trim().split(/\s+/).length} words`
            : ""}
        </span>
      </div>
    </div>
  );
}
