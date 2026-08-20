"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormatStyleLibrary } from "@repo/db";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

interface StyleCollectionCardProps {
  collection: FormatStyleLibrary;
  canManage: boolean;
}

export function StyleCollectionCard({
  collection,
  canManage,
}: StyleCollectionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete "${collection.name}"? This will remove the collection but preserve the referenced assets.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/style-collections/${collection.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete collection");
      }

      // Reload page to reflect changes
      window.location.reload();
    } catch (err) {
      alert(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setIsDeleting(false);
    }
  };

  // Determine scope badge — libraries are always format-scoped
  const getScopeBadge = () => {
    if (collection.format) {
      return collection.format;
    }
    return "Universal";
  };

  return (
    <GlassCard style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 8,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            {collection.name}
          </h3>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "var(--v2-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "3px 8px",
              borderRadius: 4,
              background: "rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            {getScopeBadge()}
          </span>
        </div>
        <p
          style={{ fontSize: 11, color: "#cdc3d7", margin: 0, lineHeight: 1.4 }}
        >
          {collection.description}
        </p>
      </div>

      {/* Text Guidelines Preview */}
      {collection.text_guidelines && (
        <div
          style={{
            padding: "12px 20px",
            background: "rgba(0,0,0,0.2)",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Text Guidelines
          </div>
          <p
            style={{
              fontSize: 10,
              color: "rgba(205,195,215,0.6)",
              margin: 0,
              lineHeight: 1.4,
              maxHeight: 60,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {collection.text_guidelines}
          </p>
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          padding: "12px 20px",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <Link
          href={`/style-collections/${collection.id}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--v2-accent)",
            textDecoration: "none",
            padding: "6px 12px",
            borderRadius: 4,
            background: "rgba(var(--v2-accent-rgb), 0.1)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            visibility
          </span>
          View Details
        </Link>
        {canManage && (
          <>
            <Link
              href={`/style-collections/${collection.id}/edit`}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#cdc3d7",
                textDecoration: "none",
                padding: "6px 12px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                edit
              </span>
              Edit
            </Link>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: isDeleting ? "#666" : "#f87171",
                background: isDeleting
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(248,113,113,0.1)",
                border: `1px solid ${isDeleting ? "rgba(255,255,255,0.1)" : "rgba(248,113,113,0.2)"}`,
                padding: "6px 12px",
                borderRadius: 4,
                cursor: isDeleting ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                delete
              </span>
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </>
        )}
      </div>
    </GlassCard>
  );
}
