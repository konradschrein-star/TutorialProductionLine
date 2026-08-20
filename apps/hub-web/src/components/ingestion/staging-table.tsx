"use client";

import { useState, useRef, useCallback } from "react";

// ── Cell-level drag-and-drop hook ──────────────────────────────────────────
// dragCounter handles nested-element enter/leave so the highlight doesn't
// flicker when the pointer passes over child elements inside the cell.

function useCellDrop(acceptExts: string[], onDrop: (file: File) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counter = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    counter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    counter.current--;
    if (counter.current <= 0) {
      counter.current = 0;
      setIsDragOver(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDropEvent = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    counter.current = 0;
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => {
      const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
      return acceptExts.includes(ext);
    });
    if (file) onDrop(file);
  };

  return { isDragOver, onDragEnter, onDragLeave, onDragOver, onDropEvent };
}

export interface StagedJob {
  id: string;
  topic: string;
  script_text: string | null;
  script_filename: string | null;
  video_file: File | null;
  video_filename: string | null;
  channel_id: string;
  subtitles: boolean;
  character_ids?: string[];
  /** Pre-uploaded video clip file paths (for Bundestag format) */
  clip_paths?: string[];
  /** Fields the user has manually overridden (don't propagate batch defaults to these) */
  overrides: Set<string>;
  validation_status: "valid" | "warning" | "error";
  validation_messages: string[];
}

interface StagingTableProps {
  jobs: StagedJob[];
  channels: Array<{ id: string; name: string }>;
  onUpdateJob: (id: string, updates: Partial<StagedJob>) => void;
  onDeleteJob: (id: string) => void;
  onDeleteSelected: (ids: string[]) => void;
  onClearAll: () => void;
  onDispatch: () => void;
  onDispatchSelected: (ids: string[]) => void;
  dispatching: boolean;
  videoLabel?: string;
  scriptLabel?: string;
  topicPlaceholder?: string;
}

export function StagingTable({
  jobs,
  channels,
  onUpdateJob,
  onDeleteJob,
  onDeleteSelected,
  onClearAll,
  onDispatch,
  onDispatchSelected,
  dispatching,
  videoLabel = "Video",
  scriptLabel = "Script",
  topicPlaceholder = "Enter topic...",
}: StagingTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const validCount = jobs.filter((j) => j.validation_status !== "error").length;
  const issueCount = jobs.filter((j) => j.validation_status === "error").length;

  // Selection helpers
  const allSelected = selectedIds.size === jobs.length && jobs.length > 0;
  const someSelected = selectedIds.size > 0 && selectedIds.size < jobs.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  }, [allSelected, jobs]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // After delete/dispatch: remove de-listed IDs from selection
  const handleDeleteSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    onDeleteSelected(ids);
    setSelectedIds(new Set());
  }, [selectedIds, onDeleteSelected]);

  const handleDispatchSelected = useCallback(() => {
    const ids = Array.from(selectedIds).filter((id) => {
      const job = jobs.find((j) => j.id === id);
      return job && job.validation_status !== "error";
    });
    if (ids.length === 0) return;
    onDispatchSelected(ids);
    setSelectedIds(new Set());
  }, [selectedIds, jobs, onDispatchSelected]);

  if (jobs.length === 0) return null;

  const selectedValidCount = Array.from(selectedIds).filter((id) => {
    const job = jobs.find((j) => j.id === id);
    return job && job.validation_status !== "error";
  }).length;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Bulk Action Bar — shown when rows are selected */}
      {selectedIds.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: "rgba(var(--v2-accent-rgb), 0.1)",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
          }}
        >
          <span
            style={{ fontSize: 12, fontWeight: 700, color: "var(--v2-accent)" }}
          >
            {selectedIds.size} selected
          </span>
          {selectedValidCount > 0 && (
            <button
              onClick={handleDispatchSelected}
              disabled={dispatching}
              className="v2-btn-accent"
              style={{ opacity: dispatching ? 0.5 : 1 }}
            >
              {dispatching ? (
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 14,
                    animation: "spin 0.7s linear infinite",
                  }}
                >
                  progress_activity
                </span>
              ) : (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  check
                </span>
              )}
              Queue {selectedValidCount}
            </button>
          )}
          <button
            onClick={handleDeleteSelected}
            disabled={dispatching}
            className="v2-btn-danger"
            style={{ opacity: dispatching ? 0.5 : 1 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              delete
            </span>
            Delete {selectedIds.size}
          </button>
          <button
            onClick={clearSelection}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {/* Select all */}
              <th style={{ padding: "12px", width: 40 }}>
                <button
                  onClick={toggleSelectAll}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "rgba(205,195,215,0.6)",
                  }}
                  title={allSelected ? "Deselect all" : "Select all"}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 18,
                      color:
                        allSelected || someSelected
                          ? "var(--v2-accent)"
                          : "rgba(205,195,215,0.6)",
                    }}
                  >
                    {allSelected
                      ? "check_box"
                      : someSelected
                        ? "indeterminate_check_box"
                        : "check_box_outline_blank"}
                  </span>
                </button>
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  width: 32,
                }}
              >
                #
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  minWidth: 200,
                }}
              >
                Topic / Title
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  minWidth: 180,
                }}
              >
                {scriptLabel}
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  minWidth: 120,
                }}
              >
                {videoLabel}
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  minWidth: 140,
                }}
              >
                Channel
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  width: 64,
                }}
              >
                Subs
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  width: 56,
                }}
              >
                OK
              </th>
              <th
                style={{
                  padding: "12px",
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                  width: 48,
                }}
              >
                &nbsp;
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-bright/50">
            {jobs.map((job, index) => (
              <StagingRow
                key={job.id}
                job={job}
                index={index + 1}
                channels={channels}
                isSelected={selectedIds.has(job.id)}
                onToggleSelect={() => toggleSelect(job.id)}
                onUpdate={(updates) => onUpdateJob(job.id, updates)}
                onDelete={() => onDeleteJob(job.id)}
                topicPlaceholder={topicPlaceholder}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ fontSize: 13, color: "rgba(205,195,215,0.6)" }}>
          {jobs.length} staged
          {issueCount > 0 && (
            <span style={{ color: "#ff8080", marginLeft: 8 }}>
              · {issueCount} with errors
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onClearAll}
            disabled={dispatching}
            className="v2-btn"
            style={{ opacity: dispatching ? 0.5 : 1 }}
          >
            Clear All
          </button>
          <button
            onClick={onDispatch}
            disabled={dispatching || validCount === 0}
            className="v2-btn-accent"
            style={{
              opacity: dispatching || validCount === 0 ? 0.5 : 1,
              cursor:
                dispatching || validCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            {dispatching ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 16,
                    animation: "spin 0.7s linear infinite",
                  }}
                >
                  progress_activity
                </span>
                Queuing...
              </>
            ) : (
              <>
                Queue {validCount} Job{validCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Row ---

function StagingRow({
  job,
  index,
  channels,
  isSelected,
  onToggleSelect,
  onUpdate,
  onDelete,
  topicPlaceholder,
}: {
  job: StagedJob;
  index: number;
  channels: Array<{ id: string; name: string }>;
  isSelected: boolean;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<StagedJob>) => void;
  onDelete: () => void;
  topicPlaceholder: string;
}) {
  const [editingTopic, setEditingTopic] = useState(false);
  const [editingScript, setEditingScript] = useState(false);
  const [topicDraft, setTopicDraft] = useState(job.topic);
  const [scriptDraft, setScriptDraft] = useState(job.script_text ?? "");

  // Script cell drop — accepts .txt / .md / .srt
  const scriptDrop = useCellDrop([".txt", ".md", ".srt"], (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      onUpdate({ script_text: text, script_filename: file.name });
    };
    reader.readAsText(file);
  });

  // Video cell drop — accepts .mp4 / .mov
  const videoDrop = useCellDrop([".mp4", ".mov"], (file) => {
    onUpdate({ video_file: file, video_filename: file.name });
  });

  const rowBg = isSelected
    ? "rgba(var(--v2-accent-rgb), 0.08)"
    : job.validation_status === "error"
      ? "rgba(255,80,80,0.05)"
      : "transparent";

  return (
    <tr
      style={{
        background: rowBg,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isSelected && job.validation_status !== "error") {
          e.currentTarget.style.background = "rgba(255,255,255,0.02)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected && job.validation_status !== "error") {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      {/* Checkbox */}
      <td style={{ padding: 12, textAlign: "center" }}>
        <button
          onClick={onToggleSelect}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(205,195,215,0.6)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 18,
              color: isSelected ? "var(--v2-accent)" : "rgba(205,195,215,0.6)",
            }}
          >
            {isSelected ? "check_box" : "check_box_outline_blank"}
          </span>
        </button>
      </td>

      {/* # */}
      <td style={{ padding: 12, fontSize: 13, color: "rgba(205,195,215,0.6)" }}>
        {index}
      </td>

      {/* Topic */}
      <td style={{ padding: 12 }}>
        {job.validation_status === "error" &&
          job.validation_messages.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginBottom: 4,
              }}
            >
              {job.validation_messages.map((msg, i) => (
                <span
                  key={i}
                  style={{ fontSize: 11, color: "#ff8080", fontWeight: 600 }}
                >
                  ⚠ {msg}
                </span>
              ))}
            </div>
          )}
        {editingTopic ? (
          <input
            autoFocus
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            onBlur={() => {
              setEditingTopic(false);
              if (topicDraft !== job.topic) {
                onUpdate({
                  topic: topicDraft,
                  overrides: new Set([...job.overrides, "topic"]),
                });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTopicDraft(job.topic);
                setEditingTopic(false);
              }
            }}
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 13,
              outline: "none",
            }}
          />
        ) : (
          <button
            onClick={() => {
              setTopicDraft(job.topic);
              setEditingTopic(true);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              fontSize: 13,
              color: job.topic ? "#e5e2e1" : "rgba(205,195,215,0.5)",
              fontStyle: job.topic ? "normal" : "italic",
              background: "none",
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={job.topic || "Click to add topic"}
          >
            {job.topic || topicPlaceholder}
          </button>
        )}
      </td>

      {/* Script — droppable cell */}
      <td
        style={{
          padding: 12,
          borderRadius: 6,
          background: scriptDrop.isDragOver
            ? "rgba(var(--v2-accent-rgb), 0.1)"
            : "transparent",
          outline: scriptDrop.isDragOver
            ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
            : "none",
          transition: "all 0.2s",
        }}
        onDragEnter={scriptDrop.onDragEnter}
        onDragLeave={scriptDrop.onDragLeave}
        onDragOver={scriptDrop.onDragOver}
        onDrop={scriptDrop.onDropEvent}
      >
        {scriptDrop.isDragOver ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--v2-accent)",
              fontWeight: 600,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              description
            </span>
            Drop script
          </div>
        ) : job.script_filename ? (
          <ScriptFileBadge
            filename={job.script_filename}
            previewText={job.script_text}
            onRemove={() =>
              onUpdate({ script_text: null, script_filename: null })
            }
          />
        ) : editingScript ? (
          <textarea
            autoFocus
            value={scriptDraft}
            onChange={(e) => setScriptDraft(e.target.value)}
            onBlur={() => {
              setEditingScript(false);
              if (scriptDraft.trim()) onUpdate({ script_text: scriptDraft });
            }}
            rows={3}
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 11,
              fontFamily: "monospace",
              outline: "none",
              resize: "vertical",
            }}
            placeholder="Paste finished script..."
          />
        ) : job.script_text ? (
          <button
            onClick={() => {
              setScriptDraft(job.script_text ?? "");
              setEditingScript(true);
            }}
            style={{
              textAlign: "left",
              fontSize: 11,
              color: "rgba(205,195,215,0.6)",
              background: "none",
              border: "none",
              cursor: "pointer",
              maxWidth: 180,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={job.script_text}
          >
            {job.script_text.split("\n")[0]?.slice(0, 60)}...
          </button>
        ) : (
          <button
            onClick={() => {
              setScriptDraft("");
              setEditingScript(true);
            }}
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              fontStyle: "italic",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Drop / click to add ↗
          </button>
        )}
      </td>

      {/* Video — droppable cell */}
      <td
        style={{
          padding: 12,
          borderRadius: 6,
          background: videoDrop.isDragOver
            ? "rgba(var(--v2-accent-rgb), 0.1)"
            : "transparent",
          outline: videoDrop.isDragOver
            ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
            : "none",
          transition: "all 0.2s",
        }}
        onDragEnter={videoDrop.onDragEnter}
        onDragLeave={videoDrop.onDragLeave}
        onDragOver={videoDrop.onDragOver}
        onDrop={videoDrop.onDropEvent}
      >
        {videoDrop.isDragOver ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--v2-accent)",
              fontWeight: 600,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              video_file
            </span>
            Drop video
          </div>
        ) : job.video_filename ? (
          <div
            className="group"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: "var(--v2-accent)" }}
            >
              video_file
            </span>
            <span
              style={{
                fontSize: 11,
                color: "#e5e2e1",
                maxWidth: 90,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={job.video_filename}
            >
              {job.video_filename}
            </span>
            <button
              onClick={() =>
                onUpdate({ video_file: null, video_filename: null })
              }
              style={{
                opacity: 0,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "rgba(205,195,215,0.6)",
                transition: "opacity 0.2s",
              }}
              className="group-hover:opacity-100"
              title="Remove video"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                close
              </span>
            </button>
          </div>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: "rgba(205,195,215,0.4)",
              fontStyle: "italic",
            }}
          >
            Drop .mp4
          </span>
        )}
      </td>

      {/* Channel */}
      <td style={{ padding: 12 }}>
        <select
          value={job.channel_id}
          onChange={(e) =>
            onUpdate({
              channel_id: e.target.value,
              overrides: new Set([...job.overrides, "channel_id"]),
            })
          }
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            borderRadius: 6,
            color: "#e5e2e1",
            fontSize: 11,
            outline: "none",
          }}
        >
          <option value="">Select...</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>

      {/* Subtitles - button toggle instead of checkbox */}
      <td style={{ padding: 12, textAlign: "center" }}>
        <button
          onClick={() =>
            onUpdate({
              subtitles: !job.subtitles,
              overrides: new Set([...job.overrides, "subtitles"]),
            })
          }
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: job.subtitles ? "var(--v2-accent)" : "rgba(205,195,215,0.4)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {job.subtitles ? "check_circle" : "radio_button_unchecked"}
          </span>
        </button>
      </td>

      {/* Status */}
      <td style={{ padding: 12, textAlign: "center" }}>
        <StatusDot
          status={job.validation_status}
          messages={job.validation_messages}
        />
      </td>

      {/* Delete */}
      <td style={{ padding: 12, textAlign: "center" }}>
        <button
          onClick={onDelete}
          style={{
            padding: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(205,195,215,0.6)",
            borderRadius: 6,
          }}
          title="Remove row"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            delete
          </span>
        </button>
      </td>
    </tr>
  );
}

// --- Sub-components ---

function ScriptFileBadge({
  filename,
  previewText,
  onRemove,
}: {
  filename: string;
  previewText: string | null;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 6,
        fontSize: 11,
      }}
      title={
        previewText ? previewText.split("\n").slice(0, 3).join("\n") : undefined
      }
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 14, color: "rgba(205,195,215,0.6)" }}
      >
        description
      </span>
      <span
        style={{
          color: "#e5e2e1",
          maxWidth: 100,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {filename}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(205,195,215,0.6)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          close
        </span>
      </button>
    </div>
  );
}

function StatusDot({
  status,
  messages,
}: {
  status: "valid" | "warning" | "error";
  messages: string[];
}) {
  const iconNames = {
    valid: "check_circle",
    warning: "warning",
    error: "error",
  };
  const colors = {
    valid: "var(--v2-success)",
    warning: "#ffb400",
    error: "#ff8080",
  };
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title={messages.join("\n") || "Valid"}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 16, color: colors[status] }}
      >
        {iconNames[status]}
      </span>
    </div>
  );
}
