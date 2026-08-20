"use client";

import { useState } from "react";
import { V2Button } from "@/app/(authenticated)/_components";

interface GenerationLogEntry {
  stage: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  model: string;
  prompt_system?: string;
  prompt_user?: string;
  raw_output?: string;
  success: boolean;
  error?: string;
}

interface GenerationLogViewerProps {
  generationLog: GenerationLogEntry[];
}

export function GenerationLogViewer({
  generationLog,
}: GenerationLogViewerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!generationLog || generationLog.length === 0) {
    return (
      <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: 0 }}>
        No generation log entries.
      </p>
    );
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {generationLog.map((entry, idx) => {
        const isExpanded = expandedIndex === idx;
        const isError = !entry.success;

        return (
          <div
            key={idx}
            style={{
              border: isError
                ? "1px solid rgba(var(--v2-error-rgb), 0.3)"
                : "1px solid var(--v2-border-1)",
              borderRadius: 6,
              background: isError
                ? "rgba(var(--v2-error-rgb), 0.04)"
                : "var(--v2-surface-1)",
              overflow: "hidden",
            }}
          >
            {/* Header: click to expand */}
            <button
              onClick={() => setExpandedIndex(isExpanded ? null : idx)}
              style={{
                width: "100%",
                padding: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "inherit",
                textAlign: "left",
              }}
            >
              {/* Status icon */}
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 18,
                  color: isError ? "var(--v2-error-soft)" : "var(--v2-success)",
                  flexShrink: 0,
                }}
              >
                {isError ? "error" : "check_circle"}
              </span>

              {/* Content */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--v2-text-1)",
                    }}
                  >
                    {entry.stage}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--v2-text-3)",
                      fontFamily: "monospace",
                    }}
                  >
                    {entry.model}
                  </span>
                </div>
                {isError && entry.error && (
                  <p
                    style={{
                      fontSize: 9,
                      color: "var(--v2-error-soft)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.error}
                  </p>
                )}
              </div>

              {/* Timing and expand icon */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--v2-text-3)",
                  }}
                >
                  {entry.duration_ms}ms
                </span>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 18,
                    color: "var(--v2-text-3)",
                  }}
                >
                  {isExpanded ? "expand_less" : "expand_more"}
                </span>
              </div>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div
                style={{
                  borderTop: "1px solid var(--v2-border-1)",
                  padding: 12,
                  background: "var(--v2-surface-0)",
                  fontSize: 9,
                }}
              >
                {/* Timestamp */}
                <div style={{ marginBottom: 12 }}>
                  <p
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: "var(--v2-text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      margin: 0,
                      marginBottom: 4,
                    }}
                  >
                    Timing
                  </p>
                  <p
                    style={{
                      fontSize: 9,
                      color: "var(--v2-text-2)",
                      margin: 0,
                      marginBottom: 2,
                    }}
                  >
                    <strong>Started:</strong>{" "}
                    {new Date(entry.started_at).toLocaleString()}
                  </p>
                  <p
                    style={{
                      fontSize: 9,
                      color: "var(--v2-text-2)",
                      margin: 0,
                    }}
                  >
                    <strong>Duration:</strong> {entry.duration_ms}ms
                  </p>
                </div>

                {/* System prompt */}
                {entry.prompt_system && (
                  <div style={{ marginBottom: 12 }}>
                    <p
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: "var(--v2-text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                        marginBottom: 4,
                      }}
                    >
                      System Prompt
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                      }}
                    >
                      <pre
                        style={{
                          fontSize: 8,
                          color: "var(--v2-text-2)",
                          background: "var(--v2-surface-1)",
                          padding: 6,
                          borderRadius: 4,
                          margin: 0,
                          overflow: "auto",
                          maxHeight: 100,
                          flex: 1,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.prompt_system}
                      </pre>
                      <V2Button
                        onClick={() =>
                          copyToClipboard(entry.prompt_system || "")
                        }
                        size="sm"
                        title="Copy"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 12 }}
                        >
                          content_copy
                        </span>
                      </V2Button>
                    </div>
                  </div>
                )}

                {/* User prompt */}
                {entry.prompt_user && (
                  <div style={{ marginBottom: 12 }}>
                    <p
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: "var(--v2-text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                        marginBottom: 4,
                      }}
                    >
                      User Prompt
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                      }}
                    >
                      <pre
                        style={{
                          fontSize: 8,
                          color: "var(--v2-text-2)",
                          background: "var(--v2-surface-1)",
                          padding: 6,
                          borderRadius: 4,
                          margin: 0,
                          overflow: "auto",
                          maxHeight: 100,
                          flex: 1,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.prompt_user}
                      </pre>
                      <V2Button
                        onClick={() => copyToClipboard(entry.prompt_user || "")}
                        size="sm"
                        title="Copy"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 12 }}
                        >
                          content_copy
                        </span>
                      </V2Button>
                    </div>
                  </div>
                )}

                {/* Raw output */}
                {entry.raw_output && (
                  <div style={{ marginBottom: 12 }}>
                    <p
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: "var(--v2-text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                        marginBottom: 4,
                      }}
                    >
                      Output
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                      }}
                    >
                      <pre
                        style={{
                          fontSize: 8,
                          color: "var(--v2-text-2)",
                          background: "var(--v2-surface-1)",
                          padding: 6,
                          borderRadius: 4,
                          margin: 0,
                          overflow: "auto",
                          maxHeight: 100,
                          flex: 1,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.raw_output}
                      </pre>
                      <V2Button
                        onClick={() => copyToClipboard(entry.raw_output || "")}
                        size="sm"
                        title="Copy"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 12 }}
                        >
                          content_copy
                        </span>
                      </V2Button>
                    </div>
                  </div>
                )}

                {/* Error */}
                {isError && entry.error && (
                  <div>
                    <p
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: "var(--v2-error-soft)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                        marginBottom: 4,
                      }}
                    >
                      Error
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "flex-start",
                      }}
                    >
                      <pre
                        style={{
                          fontSize: 8,
                          color: "var(--v2-error-soft)",
                          background: "rgba(var(--v2-error-rgb), 0.08)",
                          border: "1px solid rgba(var(--v2-error-rgb), 0.2)",
                          padding: 6,
                          borderRadius: 4,
                          margin: 0,
                          overflow: "auto",
                          maxHeight: 100,
                          flex: 1,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {entry.error}
                      </pre>
                      <V2Button
                        onClick={() => copyToClipboard(entry.error || "")}
                        size="sm"
                        title="Copy"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 12 }}
                        >
                          content_copy
                        </span>
                      </V2Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
