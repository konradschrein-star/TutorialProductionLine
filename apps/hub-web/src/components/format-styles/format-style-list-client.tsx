"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FormatStyleCard } from "./format-style-card";
import type { FormatStyleLibrary } from "@/lib/repositories/format-style-library-repository";

interface FormatStyleListClientProps {
  libraries: (FormatStyleLibrary & { reference_count?: number })[];
}

// Content formats from contracts
const CONTENT_FORMATS = [
  { id: "", label: "All Formats" },
  { id: "EXPLAINER", label: "Explainer" },
  { id: "DOCUMENTARY", label: "Documentary" },
  { id: "TECH_COMPARISON", label: "Tech Comparison" },
  { id: "VIDEO_ESSAY", label: "Video Essay" },
  { id: "CASUALLY_EXPLAINED", label: "Casually Explained" },
];

export function FormatStyleListClient({
  libraries,
}: FormatStyleListClientProps) {
  const router = useRouter();
  const [selectedFormat, setSelectedFormat] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filteredLibraries = selectedFormat
    ? libraries.filter((lib) => lib.format === selectedFormat)
    : libraries;

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        const res = await fetch(`/api/format-styles/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const json = await res.json();
          alert(`Delete failed: ${json.error ?? "Unknown error"}`);
          return;
        }
        router.refresh();
      } catch (err) {
        alert(
          `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      } finally {
        setDeleting(null);
      }
    },
    [router],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 6,
            }}
          >
            Format Style Libraries
          </h1>
          <p style={{ fontSize: 13, color: "#cdc3d7", margin: 0 }}>
            Manage visual style references for each content format
          </p>
        </div>

        <button
          onClick={() => router.push("/format-styles/create")}
          style={{
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--v2-accent)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "all 0.2s",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            add
          </span>
          Create Library
        </button>
      </div>

      {/* Format filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label
          htmlFor="format-filter"
          style={{ fontSize: 12, fontWeight: 600, color: "#cdc3d7" }}
        >
          Filter by format:
        </label>
        <select
          id="format-filter"
          value={selectedFormat}
          onChange={(e) => setSelectedFormat(e.target.value)}
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "#e5e2e1",
            background: "rgba(255,255,255, 0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {CONTENT_FORMATS.map((format) => (
            <option key={format.id} value={format.id}>
              {format.label}
            </option>
          ))}
        </select>
      </div>

      {/* Libraries grid */}
      {filteredLibraries.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            background: "rgba(255,255,255, 0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
            borderRadius: 12,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 48,
              color: "rgba(var(--v2-accent-rgb), 0.3)",
              marginBottom: 16,
            }}
          >
            palette
          </span>
          <p style={{ fontSize: 14, color: "#cdc3d7", margin: 0 }}>
            {selectedFormat
              ? `No style libraries found for ${CONTENT_FORMATS.find((f) => f.id === selectedFormat)?.label}`
              : "No style libraries yet. Create one to get started."}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {filteredLibraries.map((library) => (
            <FormatStyleCard
              key={library.id}
              library={library}
              onEdit={() => router.push(`/format-styles/${library.id}/edit`)}
              onDelete={() => handleDelete(library.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
