"use client";

import { useEffect, useState } from "react";
import type { FormatStyleLibrary } from "@repo/db";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

interface StyleCollectionPickerProps {
  channelId?: string;
  archetypeId?: string;
  format?: string;
  selectedCollectionId: string | null;
  onSelect: (collectionId: string | null) => void;
}

export function StyleCollectionPicker({
  channelId,
  archetypeId,
  format,
  selectedCollectionId,
  onSelect,
}: StyleCollectionPickerProps) {
  const [collections, setCollections] = useState<FormatStyleLibrary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCollections() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (channelId) params.append("channel_id", channelId);
        if (archetypeId) params.append("archetype_id", archetypeId);
        if (format) params.append("format", format);
        params.append("is_active", "true");

        const res = await fetch(`/api/style-collections?${params.toString()}`);
        if (res.ok) {
          // Check if response is actually JSON (not HTML redirect)
          const contentType = res.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const data = await res.json();
            setCollections(data.collections || []);
          } else {
            // Non-JSON response (likely HTML redirect) - treat as empty
            setCollections([]);
          }
        } else {
          // Non-OK response - treat as empty
          setCollections([]);
        }
      } catch (err) {
        // Silently handle errors - component will show "No style collections available" message
        setCollections([]);
      } finally {
        setLoading(false);
      }
    }

    loadCollections();
  }, [channelId, archetypeId, format]);

  if (loading) {
    return (
      <div style={{ padding: "16px", color: "#cdc3d7", fontSize: 12 }}>
        Loading style collections...
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div
        style={{
          padding: "16px",
          color: "rgba(205,195,215,0.5)",
          fontSize: 11,
        }}
      >
        No style collections available for this context. You can create one or
        proceed without.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#cdc3d7",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Style Collection (Optional)
      </div>

      {/* None Option */}
      <div onClick={() => onSelect(null)} style={{ cursor: "pointer" }}>
        <GlassCard
          style={{
            padding: "12px 16px",
            border: `2px solid ${selectedCollectionId === null ? "var(--v2-accent)" : "transparent"}`,
            background:
              selectedCollectionId === null
                ? "rgba(var(--v2-accent-rgb), 0.08)"
                : undefined,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#e5e2e1",
              marginBottom: 2,
            }}
          >
            No Style Collection
          </div>
          <div style={{ fontSize: 10, color: "#cdc3d7" }}>
            Use default visual generation without reference consistency
          </div>
        </GlassCard>
      </div>

      {/* Collections */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {collections.map((collection) => (
          <div
            key={collection.id}
            onClick={() => onSelect(collection.id)}
            style={{ cursor: "pointer" }}
          >
            <GlassCard
              style={{
                padding: "12px 16px",
                border: `2px solid ${selectedCollectionId === collection.id ? "var(--v2-accent)" : "transparent"}`,
                background:
                  selectedCollectionId === collection.id
                    ? "rgba(var(--v2-accent-rgb), 0.08)"
                    : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{ fontSize: 12, fontWeight: 600, color: "#e5e2e1" }}
                >
                  {collection.name}
                </div>
                {selectedCollectionId === collection.id && (
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, color: "var(--v2-accent)" }}
                  >
                    check_circle
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#cdc3d7", lineHeight: 1.4 }}>
                {collection.description}
              </div>
              {collection.text_guidelines && (
                <div
                  style={{
                    fontSize: 9,
                    color: "rgba(205,195,215,0.5)",
                    marginTop: 6,
                    padding: "6px 8px",
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: 4,
                    maxHeight: 40,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {collection.text_guidelines}
                </div>
              )}
            </GlassCard>
          </div>
        ))}
      </div>
    </div>
  );
}
