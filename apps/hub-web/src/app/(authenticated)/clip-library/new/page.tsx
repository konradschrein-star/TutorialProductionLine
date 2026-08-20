"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassCard } from "../../_components/glass-card";

export default function NewClipLibraryPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState<"inline" | "materialized">("inline");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clip-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          clip_storage_strategy: strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/clip-library/${data.library.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create library");
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(var(--v2-accent-rgb), 0.18)",
    borderRadius: 8,
    color: "#e5e2e1",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "rgba(205,195,215,0.6)",
    marginBottom: 6,
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Link
          href="/clip-library"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            color: "#e5e2e1",
            textDecoration: "none",
            fontSize: 18,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            arrow_back
          </span>
        </Link>
        <div>
          <h1
            style={{
              color: "#e5e2e1",
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
            }}
          >
            New Clip Library
          </h1>
          <p
            style={{
              color: "rgba(205,195,215,0.5)",
              fontSize: 12,
              margin: "2px 0 0 0",
            }}
          >
            Create a new library to ingest and manage video clips
          </p>
        </div>
      </div>

      <GlassCard style={{ padding: 28 }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 20 }}
        >
          {/* Name */}
          <div>
            <label style={labelStyle}>Library Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Casually Explained Source Clips"
              required
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of this clip library..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>

          {/* Storage Strategy */}
          <div>
            <label style={labelStyle}>Clip Storage Strategy</label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["inline", "materialized"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 8,
                    border:
                      strategy === s
                        ? "1px solid rgba(var(--v2-accent-rgb), 0.6)"
                        : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                    background:
                      strategy === s
                        ? "rgba(var(--v2-accent-rgb), 0.12)"
                        : "rgba(255,255,255,0.03)",
                    color: strategy === s ? "var(--v2-accent)" : "#cdc3d7",
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <p
              style={{
                color: "rgba(205,195,215,0.4)",
                fontSize: 11,
                margin: "6px 0 0 0",
              }}
            >
              {strategy === "inline"
                ? "Seek into source video at render time — saves storage, requires source file to remain accessible."
                : "Extract each clip to a separate file — more storage, but clips work independently of source."}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p
              style={{
                color: "#ef4444",
                fontSize: 12,
                margin: 0,
                padding: "10px 14px",
                background: "rgba(239,68,68,0.08)",
                borderRadius: 6,
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              paddingTop: 4,
            }}
          >
            <Link
              href="/clip-library"
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                color: "#cdc3d7",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background:
                  submitting || !name.trim()
                    ? "rgba(var(--v2-accent-rgb), 0.4)"
                    : "var(--v2-accent)",
                color: "#000",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: submitting || !name.trim() ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Creating..." : "Create Library"}
            </button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
