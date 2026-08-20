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

interface SceneErrorPanelProps {
  sceneIndex: number;
  generationLog: GenerationLogEntry[];
  onEditPrompt?: (newPrompt: string) => void;
  onRetryWithPrompt?: (newPrompt: string) => Promise<void>;
  onViewLogs?: () => void;
}

export function SceneErrorPanel({
  sceneIndex,
  generationLog,
  onEditPrompt,
  onRetryWithPrompt,
  onViewLogs,
}: SceneErrorPanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(
    null,
  );
  const [editedPrompt, setEditedPrompt] = useState("");
  const [retrying, setRetrying] = useState(false);

  // Filter errors for this scene
  const sceneErrors = generationLog.filter(
    (entry) => entry.stage === `scene_image` && entry.error && !entry.success,
  );

  if (sceneErrors.length === 0) {
    return null;
  }

  function copyErrorCode(errorMsg: string) {
    navigator.clipboard.writeText(errorMsg).then(() => {
      // Show brief feedback
      const event = new CustomEvent("clipboard-copied", {
        detail: { text: "Copied to clipboard" },
      });
      window.dispatchEvent(event);
    });
  }

  function handleEditPrompt(entry: GenerationLogEntry, index: number) {
    setEditingPromptIndex(index);
    setEditedPrompt(entry.prompt_user || "");
  }

  function handleSavePrompt() {
    if (editingPromptIndex !== null && onEditPrompt) {
      onEditPrompt(editedPrompt);
      setEditingPromptIndex(null);
    }
  }

  async function handleRetryWithPrompt() {
    if (editingPromptIndex !== null && onRetryWithPrompt) {
      setRetrying(true);
      try {
        await onRetryWithPrompt(editedPrompt);
        setEditingPromptIndex(null);
      } finally {
        setRetrying(false);
      }
    }
  }

  return (
    <div
      style={{
        background: "rgba(var(--v2-error-rgb), 0.04)",
        border: "1px solid rgba(var(--v2-error-rgb), 0.2)",
        borderRadius: 8,
        padding: 16,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: "var(--v2-error-soft)",
            flexShrink: 0,
          }}
        >
          error
        </span>
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-error-soft)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Generation Error{sceneErrors.length > 1 ? "s" : ""}
          </p>
          <p
            style={{
              fontSize: 10,
              color: "var(--v2-text-3)",
              margin: 0,
              marginTop: 2,
            }}
          >
            {sceneErrors.length} error{sceneErrors.length > 1 ? "s" : ""} found
            during image generation
          </p>
        </div>
      </div>

      {/* Error entries */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sceneErrors.map((entry, idx) => (
          <div
            key={idx}
            style={{
              background: "var(--v2-surface-1)",
              border: "1px solid var(--v2-border-1)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {/* Header: click to expand */}
            <button
              onClick={() =>
                setExpandedIndex(expandedIndex === idx ? null : idx)
              }
              style={{
                width: "100%",
                padding: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                color: "inherit",
                textAlign: "left",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 16,
                  color: "var(--v2-text-3)",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {expandedIndex === idx ? "expand_less" : "expand_more"}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--v2-text-1)",
                    margin: 0,
                    marginBottom: 4,
                  }}
                >
                  {entry.model} ({entry.stage})
                </p>
                <p
                  style={{
                    fontSize: 10,
                    color: "var(--v2-error-soft)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "monospace",
                  }}
                >
                  {entry.error}
                </p>
                <p
                  style={{
                    fontSize: 9,
                    color: "var(--v2-text-3)",
                    margin: 0,
                    marginTop: 4,
                  }}
                >
                  {new Date(entry.started_at).toLocaleTimeString()} •{" "}
                  {entry.duration_ms}ms
                </p>
              </div>
            </button>

            {/* Expanded details */}
            {expandedIndex === idx && (
              <div
                style={{
                  borderTop: "1px solid var(--v2-border-1)",
                  padding: 12,
                  background: "rgba(var(--v2-surface-0-rgb), 0.5)",
                }}
              >
                {/* Error message (copyable) */}
                <div style={{ marginBottom: 12 }}>
                  <p
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--v2-text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      margin: 0,
                      marginBottom: 6,
                    }}
                  >
                    Error Details
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <code
                      style={{
                        fontSize: 9,
                        color: "var(--v2-error-soft)",
                        background: "var(--v2-surface-0)",
                        padding: 8,
                        borderRadius: 4,
                        overflow: "auto",
                        maxHeight: 100,
                        flex: 1,
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {entry.error}
                    </code>
                    <V2Button
                      onClick={() => copyErrorCode(entry.error || "")}
                      size="sm"
                      title="Copy error to clipboard"
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

                {/* Prompt */}
                {entry.prompt_user && (
                  <div style={{ marginBottom: 12 }}>
                    <p
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--v2-text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        margin: 0,
                        marginBottom: 6,
                      }}
                    >
                      Generation Prompt
                    </p>
                    {editingPromptIndex === idx ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <textarea
                          value={editedPrompt}
                          onChange={(e) => setEditedPrompt(e.target.value)}
                          style={{
                            fontSize: 9,
                            color: "var(--v2-text-1)",
                            background: "var(--v2-surface-0)",
                            border: "1px solid var(--v2-border-1)",
                            borderRadius: 4,
                            padding: 8,
                            fontFamily: "monospace",
                            minHeight: 80,
                            maxHeight: 200,
                            overflow: "auto",
                            resize: "vertical",
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                          }}
                        >
                          <V2Button
                            onClick={handleRetryWithPrompt}
                            disabled={retrying}
                            variant="accent"
                            size="sm"
                            title="Retry with edited prompt"
                          >
                            {retrying ? (
                              <span
                                className="material-symbols-outlined"
                                style={{
                                  fontSize: 12,
                                  animation: "spin 1s linear infinite",
                                }}
                              >
                                progress_activity
                              </span>
                            ) : (
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 12 }}
                              >
                                refresh
                              </span>
                            )}
                            Retry
                          </V2Button>
                          <V2Button
                            onClick={handleSavePrompt}
                            size="sm"
                            title="Save edited prompt"
                          >
                            Save
                          </V2Button>
                          <V2Button
                            onClick={() => setEditingPromptIndex(null)}
                            disabled={retrying}
                            size="sm"
                            title="Cancel editing"
                          >
                            Cancel
                          </V2Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <code
                          style={{
                            fontSize: 9,
                            color: "var(--v2-text-2)",
                            background: "var(--v2-surface-0)",
                            padding: 8,
                            borderRadius: 4,
                            overflow: "auto",
                            maxHeight: 100,
                            flex: 1,
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {entry.prompt_user}
                        </code>
                        <V2Button
                          onClick={() => handleEditPrompt(entry, idx)}
                          size="sm"
                          title="Edit prompt and retry"
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 12 }}
                          >
                            edit
                          </span>
                        </V2Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Timing */}
                <div>
                  <p
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--v2-text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      margin: 0,
                      marginBottom: 6,
                    }}
                  >
                    Timing
                  </p>
                  <div style={{ fontSize: 9, color: "var(--v2-text-2)" }}>
                    <p style={{ margin: 0, marginBottom: 4 }}>
                      <strong>Started:</strong>{" "}
                      {new Date(entry.started_at).toLocaleString()}
                    </p>
                    <p style={{ margin: 0, marginBottom: 4 }}>
                      <strong>Completed:</strong>{" "}
                      {new Date(entry.completed_at).toLocaleString()}
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>Duration:</strong> {entry.duration_ms}ms
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Link to logs */}
      {onViewLogs && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--v2-border-1)",
          }}
        >
          <button
            onClick={onViewLogs}
            style={{
              fontSize: 10,
              color: "var(--v2-accent)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: 0,
            }}
            title="View full generation log"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              description
            </span>
            View full generation log
          </button>
        </div>
      )}
    </div>
  );
}
