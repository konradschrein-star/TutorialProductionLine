"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

const CONTENT_FORMATS = [
  { id: "EXPLAINER", label: "Explainer" },
  { id: "DOCUMENTARY", label: "Documentary" },
  { id: "TECH_COMPARISON", label: "Tech Comparison" },
  { id: "VIDEO_ESSAY", label: "Video Essay" },
  { id: "CASUALLY_EXPLAINED", label: "Casually Explained" },
];

export default function EditFormatStylePage() {
  const router = useRouter();
  const params = useParams();
  const libraryId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState("EXPLAINER");
  const [textGuidelines, setTextGuidelines] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing library data
  useEffect(() => {
    async function loadLibrary() {
      try {
        const res = await fetch(`/api/format-styles/${libraryId}`);
        if (!res.ok) throw new Error("Failed to load library");

        const { library } = await res.json();
        setName(library.name);
        setDescription(library.description);
        setFormat(library.format);
        setTextGuidelines(library.text_guidelines || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load library");
      } finally {
        setLoading(false);
      }
    }

    loadLibrary();
  }, [libraryId]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!name.trim() || !description.trim()) {
        setError("Name and description are required");
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const res = await fetch(`/api/format-styles/${libraryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            format,
            text_guidelines: textGuidelines.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to update library");
        }

        router.push("/format-styles");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update library",
        );
      } finally {
        setSaving(false);
      }
    },
    [libraryId, name, description, format, textGuidelines, router],
  );

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "24px 0",
          textAlign: "center",
        }}
      >
        <p style={{ color: "#cdc3d7", fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#cdc3d7",
            background: "transparent",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            borderRadius: 6,
            cursor: "pointer",
            marginBottom: 16,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            arrow_back
          </span>
          Back
        </button>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Edit Format Style Library
        </h1>
        <p style={{ fontSize: 13, color: "#cdc3d7", margin: 0 }}>
          Update visual style references for this content format
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <GlassCard
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Name */}
          <div>
            <label
              htmlFor="name"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#e5e2e1",
                marginBottom: 8,
              }}
            >
              Library Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                color: "#e5e2e1",
                background: "rgba(255,255,255, 0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 6,
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#e5e2e1",
                marginBottom: 8,
              }}
            >
              Description *
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                color: "#e5e2e1",
                background: "rgba(255,255,255, 0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 6,
                resize: "vertical",
              }}
            />
          </div>

          {/* Format */}
          <div>
            <label
              htmlFor="format"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#e5e2e1",
                marginBottom: 8,
              }}
            >
              Content Format *
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                color: "#e5e2e1",
                background: "rgba(255,255,255, 0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {CONTENT_FORMATS.map((fmt) => (
                <option key={fmt.id} value={fmt.id}>
                  {fmt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Text Guidelines */}
          <div>
            <label
              htmlFor="text-guidelines"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#e5e2e1",
                marginBottom: 8,
              }}
            >
              Text Guidelines (optional)
            </label>
            <textarea
              id="text-guidelines"
              value={textGuidelines}
              onChange={(e) => setTextGuidelines(e.target.value)}
              rows={6}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                color: "#e5e2e1",
                background: "rgba(255,255,255, 0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 6,
                resize: "vertical",
                fontFamily: "monospace",
              }}
            />
            <p style={{ fontSize: 11, color: "#cdc3d7", margin: "6px 0 0 0" }}>
              These guidelines will be injected into AI image generation prompts
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: 12,
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 6,
                fontSize: 12,
                color: "#ef4444",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              onClick={() => router.back()}
              disabled={saving}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                color: "#cdc3d7",
                background: "transparent",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 8,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: saving ? "#666" : "var(--v2-accent)",
                border: "none",
                borderRadius: 8,
                cursor: saving ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {saving ? (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18 }}
                  >
                    hourglass_empty
                  </span>
                  Saving...
                </>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18 }}
                  >
                    check
                  </span>
                  Save Changes
                </>
              )}
            </button>
          </div>
        </GlassCard>
      </form>
    </div>
  );
}
