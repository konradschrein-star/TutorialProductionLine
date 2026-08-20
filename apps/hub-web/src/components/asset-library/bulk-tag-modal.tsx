"use client";

import { useState, useEffect, useRef } from "react";

interface BulkTagModalProps {
  open: boolean;
  assetCount: number;
  onConfirm: (tags: string[]) => Promise<void>;
  onCancel: () => void;
}

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .filter((tag, index, self) => self.indexOf(tag) === index); // Deduplicate
}

export function BulkTagModal({
  open,
  assetCount,
  onConfirm,
  onCancel,
}: BulkTagModalProps) {
  const [tagInput, setTagInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input and reset state when modal opens
  useEffect(() => {
    if (open) {
      setTagInput("");
      inputRef.current?.focus();
    }
  }, [open]);

  // Close on Escape (document-level listener)
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, submitting, onCancel]);

  if (!open) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const tags = parseTags(tagInput);
    if (tags.length === 0) {
      alert("Please enter at least one tag");
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(tags);
      setTagInput(""); // Clear input on success
    } finally {
      setSubmitting(false);
    }
  };

  const parsedTags = parseTags(tagInput);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={!submitting ? onCancel : undefined}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {/* Modal Card */}
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Add tags to assets"
          style={{
            maxWidth: 480,
            width: "90%",
            background: "var(--v2-surface-container)",
            borderRadius: 16,
            border: "1px solid var(--v2-surface-bright)",
            padding: 24,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
            cursor: "default",
          }}
        >
          {/* Header */}
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
              style={{ fontSize: 28, color: "var(--v2-accent)" }}
            >
              sell
            </span>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--v2-text-1)",
                margin: 0,
              }}
            >
              Add Tags to {assetCount} {assetCount === 1 ? "Asset" : "Assets"}
            </h3>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Tag input */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="tag-input"
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--v2-text-2)",
                  marginBottom: 8,
                }}
              >
                Tags (comma-separated):
              </label>
              <input
                ref={inputRef}
                id="tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="episode-5, reviewed, final-cut"
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--v2-surface-bright)",
                  background: "var(--v2-surface-container)",
                  color: "var(--v2-text-1)",
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.2s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(var(--v2-accent-rgb), 0.4)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor =
                    "var(--v2-surface-bright)";
                }}
              />

              {/* Tag preview */}
              {parsedTags.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {parsedTags.map((tag, i) => (
                    <span
                      key={i}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(var(--v2-accent-rgb), 0.15)",
                        color: "var(--v2-accent)",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Info message */}
            <p
              style={{
                fontSize: 13,
                color: "var(--v2-text-2)",
                margin: "0 0 20px 0",
              }}
            >
              These tags will be added to all selected assets. Existing tags
              will be preserved.
            </p>

            {/* Action buttons */}
            <div
              style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--v2-surface-bright)",
                  background: "transparent",
                  color: "var(--v2-text-2)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: submitting ? "not-allowed" : "pointer",
                  opacity: submitting ? 0.5 : 1,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.background =
                      "var(--v2-surface-bright)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting || parsedTags.length === 0}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    submitting || parsedTags.length === 0
                      ? "var(--v2-surface-bright)"
                      : "var(--v2-accent)",
                  color:
                    submitting || parsedTags.length === 0
                      ? "var(--v2-text-2)"
                      : "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    submitting || parsedTags.length === 0
                      ? "not-allowed"
                      : "pointer",
                  opacity: submitting || parsedTags.length === 0 ? 0.5 : 1,
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  if (!submitting && parsedTags.length > 0) {
                    e.currentTarget.style.opacity = "0.9";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!submitting && parsedTags.length > 0) {
                    e.currentTarget.style.opacity = "1";
                  }
                }}
              >
                {submitting ? (
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
                    Adding...
                  </>
                ) : (
                  <>
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      sell
                    </span>
                    Add Tags
                  </>
                )}
              </button>
            </div>
          </form>
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
