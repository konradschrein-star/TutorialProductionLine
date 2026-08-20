"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";

interface ThumbnailRow {
  id: string;
  status: "pending" | "generating" | "completed" | "failed" | string;
  prompt_used: string;
  output_path: string | null;
  is_selected: boolean;
  language: string;
  created_at: string;
  archetype_id: string | null;
  error_message?: string | null;
}

interface Props {
  jobId: string;
  kind?: "content_job" | "tutorial_job";
}

// Local constant — languages here are NOT the dynamic-formats concern.
const LANGUAGES = [
  "Spanish",
  "German",
  "French",
  "Portuguese",
  "Italian",
  "Hindi",
  "Japanese",
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  color: "#e5e2e1",
  background: "rgba(255,255,255, 0.05)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
  borderRadius: 6,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#e5e2e1",
  marginBottom: 8,
};

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: disabled ? "#666" : "var(--v2-accent)",
    border: "none",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };
}

function pickCurrent(rows: ThumbnailRow[]): ThumbnailRow | undefined {
  const selected = rows.find((r) => r.is_selected);
  if (selected) return selected;
  return rows.find((r) => r.status === "completed");
}

export function ThumbnailPanel({ jobId, kind = "content_job" }: Props) {
  const [rows, setRows] = useState<ThumbnailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showRegenerate, setShowRegenerate] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [changeInstructions, setChangeInstructions] = useState("");
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const fetchThumbnails = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/thumbnail?kind=${kind}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to load thumbnails (${res.status})`);
    }
    const json = (await res.json()) as ThumbnailRow[];
    return json;
  }, [jobId, kind]);

  const refresh = useCallback(async () => {
    try {
      const json = await fetchThumbnails();
      setRows(json);
      const current = pickCurrent(json);
      if (current) setEditedPrompt(current.prompt_used ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchThumbnails]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, kind]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBusy(false);
  }, []);

  const startPolling = useCallback(
    (watchIds: Set<string>) => {
      pollDeadlineRef.current = Date.now() + 60_000;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const json = await fetchThumbnails();
          setRows(json);
          const watched = json.filter((r) => watchIds.has(r.id));
          const allSettled =
            watched.length > 0 &&
            watched.every(
              (r) => r.status === "completed" || r.status === "failed",
            );
          if (allSettled || Date.now() > pollDeadlineRef.current) {
            const current = pickCurrent(json);
            if (current) setEditedPrompt(current.prompt_used ?? "");
            stopPolling();
          }
        } catch {
          // keep polling until deadline; transient errors ignored
          if (Date.now() > pollDeadlineRef.current) stopPolling();
        }
      }, 2000);
    },
    [fetchThumbnails, stopPolling],
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const submit = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const beforeIds = new Set(rows.map((r) => r.id));
        const res = await fetch(`/api/jobs/${jobId}/thumbnail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, ...body }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }
        // Re-fetch immediately to discover the new row id(s), then poll.
        const json = await fetchThumbnails();
        setRows(json);
        const newIds = new Set(
          json.filter((r) => !beforeIds.has(r.id)).map((r) => r.id),
        );
        if (newIds.size === 0) {
          // Fallback: watch every non-completed row.
          json
            .filter((r) => r.status !== "completed" && r.status !== "failed")
            .forEach((r) => newIds.add(r.id));
        }
        startPolling(newIds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
        setBusy(false);
      }
    },
    [jobId, kind, rows, fetchThumbnails, startPolling],
  );

  const handleRegenerateSame = useCallback(() => {
    const current = pickCurrent(rows);
    const trimmed = editedPrompt.trim();
    const unchanged = current && trimmed === (current.prompt_used ?? "").trim();
    submit({
      mode: "same",
      ...(trimmed && !unchanged ? { editedPrompt: trimmed } : {}),
    });
  }, [rows, editedPrompt, submit]);

  const handleRegenerateChanges = useCallback(() => {
    if (!changeInstructions.trim()) return;
    submit({ mode: "changes", instructions: changeInstructions.trim() });
    setChangeInstructions("");
  }, [changeInstructions, submit]);

  const handleLocalize = useCallback(() => {
    if (selectedLanguages.length === 0) return;
    submit({ mode: "localize", languages: selectedLanguages });
    setSelectedLanguages([]);
  }, [selectedLanguages, submit]);

  const toggleLanguage = useCallback((lang: string) => {
    setSelectedLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }, []);

  const current = pickCurrent(rows);
  const failedRows = rows.filter(
    (r) => r.status === "failed" && r.error_message,
  );
  const grouped = rows.reduce<Record<string, ThumbnailRow[]>>((acc, r) => {
    const key = r.language || "en";
    (acc[key] ??= []).push(r);
    return acc;
  }, {});

  return (
    <GlassCard
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--v2-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            margin: 0,
          }}
        >
          Thumbnail
        </h2>
        {busy && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--v2-accent)",
            }}
          >
            <span
              className="material-symbols-outlined animate-pulse"
              style={{ fontSize: 14 }}
            >
              progress_activity
            </span>
            Generating…
          </span>
        )}
      </div>

      {/* Current thumbnail */}
      {loading ? (
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>Loading…</p>
      ) : current ? (
        <img
          src={`/api/thumbnails/image/${current.id}`}
          alt="Current thumbnail"
          style={{ maxWidth: "100%", borderRadius: 8, display: "block" }}
        />
      ) : (
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          No thumbnail generated yet.
        </p>
      )}

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

      {failedRows.length > 0 && (
        <div
          style={{
            padding: 12,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: 6,
            fontSize: 12,
            color: "#ef4444",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {failedRows.slice(0, 3).map((r) => (
            <span key={r.id}>
              [{r.language}] {r.error_message}
            </span>
          ))}
        </div>
      )}

      {/* Control 1 — Regenerate (same reference) */}
      <div
        style={{
          borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          paddingTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowRegenerate((v) => !v)}
            title="Reuses the original reference style. Edit the prompt first to fix mistakes before regenerating."
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#cdc3d7",
              background: "transparent",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Regenerate
          </button>
          <span style={{ fontSize: 11, color: "rgba(205,195,215,0.5)" }}>
            Reuses the original reference style. Edit the prompt first to fix
            mistakes before regenerating.
          </span>
        </div>
        {showRegenerate && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="thumb-prompt" style={labelStyle}>
              Prompt
            </label>
            <textarea
              id="thumb-prompt"
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={3}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "monospace",
              }}
            />
            <div>
              <button
                type="button"
                onClick={handleRegenerateSame}
                disabled={busy}
                style={buttonStyle(busy)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  refresh
                </span>
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Control 2 — Regenerate with changes */}
      <div
        style={{
          borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          paddingTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <label htmlFor="thumb-changes" style={labelStyle}>
          Regenerate with changes
        </label>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "0 0 4px 0",
          }}
        >
          Uses the current thumbnail as the base and applies only your requested
          changes.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="thumb-changes"
            type="text"
            value={changeInstructions}
            onChange={(e) => setChangeInstructions(e.target.value)}
            placeholder="e.g., make the text bigger and remove the arrow"
            title="Uses the current thumbnail as the base and applies only your requested changes."
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={handleRegenerateChanges}
            disabled={busy || !changeInstructions.trim() || !current}
            style={buttonStyle(busy || !changeInstructions.trim() || !current)}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              auto_fix_high
            </span>
            Apply
          </button>
        </div>
      </div>

      {/* Control 3 — Localize */}
      <div
        style={{
          borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          paddingTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <label style={labelStyle}>Localize</label>
        <p
          style={{
            fontSize: 11,
            color: "rgba(205,195,215,0.5)",
            margin: "0 0 4px 0",
          }}
        >
          Generate localized variants from the current thumbnail.
        </p>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          title="Generate localized variants from the current thumbnail."
        >
          {LANGUAGES.map((lang) => {
            const active = selectedLanguages.includes(lang);
            return (
              <label
                key={lang}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 999,
                  cursor: "pointer",
                  border: active
                    ? "1px solid var(--v2-accent)"
                    : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  background: active
                    ? "rgba(var(--v2-accent-rgb), 0.15)"
                    : "transparent",
                  color: active ? "var(--v2-accent)" : "#cdc3d7",
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleLanguage(lang)}
                  style={{ display: "none" }}
                />
                {lang}
              </label>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            onClick={handleLocalize}
            disabled={busy || selectedLanguages.length === 0 || !current}
            style={buttonStyle(
              busy || selectedLanguages.length === 0 || !current,
            )}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              translate
            </span>
            Localize
          </button>
        </div>
      </div>

      {/* Gallery — all variants grouped by language */}
      {rows.length > 0 && (
        <div
          style={{
            borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            paddingTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h3
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            All Variants
          </h3>
          {Object.entries(grouped).map(([lang, items]) => (
            <div
              key={lang}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {lang}
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 10,
                }}
              >
                {items.map((row) => (
                  <GlassCard
                    key={row.id}
                    style={{
                      padding: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      border: row.is_selected
                        ? "1px solid var(--v2-accent)"
                        : undefined,
                    }}
                  >
                    {row.status === "completed" && row.output_path ? (
                      <img
                        src={`/api/thumbnails/image/${row.id}`}
                        alt={`${lang} thumbnail`}
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "16 / 9",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.03)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 20,
                            color: "rgba(205,195,215,0.4)",
                          }}
                        >
                          {row.status === "failed"
                            ? "error"
                            : "hourglass_empty"}
                        </span>
                      </div>
                    )}
                    <span style={{ fontSize: 10, color: "#cdc3d7" }}>
                      {row.status}
                      {row.is_selected ? " · selected" : ""}
                    </span>
                  </GlassCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
