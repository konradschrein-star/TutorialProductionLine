"use client";

import { useState, useEffect } from "react";
import type { AssetCardAsset } from "./asset-card";

interface BulkDeleteModalProps {
  open: boolean;
  assets: AssetCardAsset[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function BulkDeleteModal({
  open,
  assets,
  onConfirm,
  onCancel,
}: BulkDeleteModalProps) {
  const [deleting, setDeleting] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
        onCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, deleting, onCancel]);

  if (!open) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  const displayAssets = assets.slice(0, 3);
  const remainingCount = assets.length - 3;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={!deleting ? onCancel : undefined}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          cursor: deleting ? "wait" : "pointer",
        }}
      >
        {/* Modal Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm bulk delete"
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: 400,
            width: "90%",
            background: "var(--v2-surface-container)",
            borderRadius: 16,
            border: "1px solid var(--v2-surface-bright)",
            padding: 24,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
            cursor: "default",
          }}
        >
          {/* Header with warning icon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28, color: "#ef4444" }}
            >
              warning
            </span>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--v2-text-1)",
                margin: 0,
              }}
            >
              Delete {assets.length} {assets.length === 1 ? "asset" : "assets"}?
            </h3>
          </div>

          {/* Asset list */}
          <div style={{ marginBottom: 16 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--v2-text-2)",
                margin: "0 0 12px 0",
              }}
            >
              This will permanently delete:
            </p>
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 20px",
                fontSize: 13,
                color: "var(--v2-text-1)",
              }}
            >
              {displayAssets.map((asset) => (
                <li key={asset.id} style={{ marginBottom: 4 }}>
                  {asset.name}
                </li>
              ))}
              {remainingCount > 0 && (
                <li style={{ color: "var(--v2-text-2)", fontStyle: "italic" }}>
                  and {remainingCount} more...
                </li>
              )}
            </ul>
          </div>

          {/* Warning message */}
          <p
            style={{
              fontSize: 13,
              color: "var(--v2-text-2)",
              margin: "0 0 20px 0",
              fontWeight: 500,
            }}
          >
            This action cannot be undone.
          </p>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              onClick={onCancel}
              disabled={deleting}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--v2-surface-bright)",
                background: "transparent",
                color: "var(--v2-text-2)",
                fontSize: 13,
                fontWeight: 500,
                cursor: deleting ? "not-allowed" : "pointer",
                opacity: deleting ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!deleting) {
                  e.currentTarget.style.background = "var(--v2-surface-bright)";
                }
              }}
              onMouseLeave={(e) => {
                if (!deleting) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleConfirm}
              disabled={deleting}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#ef4444",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: deleting ? "wait" : "pointer",
                opacity: deleting ? 0.7 : 1,
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!deleting) {
                  e.currentTarget.style.background = "#dc2626";
                }
              }}
              onMouseLeave={(e) => {
                if (!deleting) {
                  e.currentTarget.style.background = "#ef4444";
                }
              }}
            >
              {deleting ? (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 16,
                      animation: "spin 1s linear infinite",
                    }}
                  >
                    progress_activity
                  </span>
                  Deleting...
                </>
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    delete
                  </span>
                  Delete Assets
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
