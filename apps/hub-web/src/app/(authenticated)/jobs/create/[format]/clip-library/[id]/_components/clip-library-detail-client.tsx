"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassCard } from "../../../../../../_components/glass-card";

interface StockClipRow {
  id: string;
  prompt: string;
  vibe_tag: string | null;
  status: "queued" | "generating" | "ready" | "failed";
  origin: string;
  duration_sec: number;
  veo_job_id: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

interface SnapshotResponse {
  counts: Record<"queued" | "generating" | "ready" | "failed", number>;
  total: number;
  recent: StockClipRow[];
  /** Most recent ready clip timestamp (ms epoch) for "x min ago" display. */
  last_ready_at: string | null;
  /** Ready clips produced in the last hour. */
  ready_last_hour: number;
}

interface LogsResponse {
  lines: string[];
}

interface InitialLibrary {
  id: string;
  name: string;
  character_block: string;
  script_prompt: string;
  music_mode: string;
  music_volume_db: number;
  use_reference_scripts: boolean;
}

interface ReferenceScriptRow {
  id: string;
  name: string;
  word_count: number;
  last_used_at: string | null;
  preview: string;
}

const STATUS_COLOR: Record<
  StockClipRow["status"],
  { bg: string; color: string }
> = {
  queued: { bg: "rgba(250,204,21,0.18)", color: "#facc15" },
  generating: { bg: "rgba(96,165,250,0.18)", color: "#60a5fa" },
  ready: { bg: "rgba(74,222,128,0.18)", color: "#4ade80" },
  failed: { bg: "rgba(248,113,113,0.18)", color: "#f87171" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

function StatusChip({ status }: { status: StockClipRow["status"] }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function CountTile({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: number | string;
  color: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: "#cdc3d7",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {sub && <span style={{ fontSize: 10, color: "#cdc3d7" }}>{sub}</span>}
    </div>
  );
}

function ProgressBar({
  ready,
  failed,
  generating,
  queued,
  target,
}: {
  ready: number;
  failed: number;
  generating: number;
  queued: number;
  target: number | null;
}) {
  const denom =
    target && target > 0
      ? target
      : Math.max(ready + failed + generating + queued, 1);
  const pct = (n: number) => (Math.min(n, denom) / denom) * 100;
  return (
    <div
      style={{
        position: "relative",
        height: 18,
        background: "rgba(255,255,255,0.05)",
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct(ready)}%`,
          background: "#4ade80",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${pct(ready)}%`,
          top: 0,
          bottom: 0,
          width: `${pct(generating)}%`,
          background: "#60a5fa",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${pct(ready) + pct(generating)}%`,
          top: 0,
          bottom: 0,
          width: `${pct(failed)}%`,
          background: "#f87171",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "#0a0a0a",
          textShadow: "0 0 4px rgba(255,255,255,0.4)",
        }}
      >
        {ready}/{denom} ready · {generating} in flight · {failed} failed ·{" "}
        {queued} waiting
      </div>
    </div>
  );
}

export default function ClipLibraryDetailClient({
  libraryId,
  initialLibrary,
  initialReferenceScripts,
  format,
}: {
  libraryId: string;
  initialLibrary: InitialLibrary;
  initialReferenceScripts: ReferenceScriptRow[];
  format: string;
}) {
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [bootstrapCount, setBootstrapCount] = useState<string>("5000");
  const [bootstrapBatchSize, setBootstrapBatchSize] = useState<string>("100");
  const [target, setTarget] = useState<number | null>(null);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [lib, setLib] = useState(initialLibrary);
  const [savingLib, setSavingLib] = useState(false);
  const [libSaveMessage, setLibSaveMessage] = useState<string | null>(null);

  // Reference scripts
  const [references, setReferences] = useState<ReferenceScriptRow[]>(
    initialReferenceScripts,
  );
  const [previewRefId, setPreviewRefId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [newRefName, setNewRefName] = useState("");
  const [newRefContent, setNewRefContent] = useState("");
  const [addingRef, setAddingRef] = useState(false);

  const refreshReferences = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/drama/clip-libraries/${libraryId}/reference-scripts`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { scripts: ReferenceScriptRow[] };
      setReferences(data.scripts);
    } catch {
      /* ignore */
    }
  }, [libraryId]);

  const openPreview = async (refId: string) => {
    setPreviewRefId(refId);
    setPreviewContent(null);
    try {
      const res = await fetch(
        `/api/drama/clip-libraries/${libraryId}/reference-scripts/${refId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setPreviewContent(`Failed to load: HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { script: { content: string } };
      setPreviewContent(data.script.content);
    } catch (err) {
      setPreviewContent(err instanceof Error ? err.message : String(err));
    }
  };

  const addReferenceScript = async () => {
    if (!newRefName.trim() || !newRefContent.trim()) return;
    setAddingRef(true);
    try {
      const res = await fetch(
        `/api/drama/clip-libraries/${libraryId}/reference-scripts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newRefName.trim(),
            content: newRefContent,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Failed: ${data.error ?? res.status}`);
        return;
      }
      setNewRefName("");
      setNewRefContent("");
      await refreshReferences();
    } finally {
      setAddingRef(false);
    }
  };

  const deleteReferenceScript = async (refId: string) => {
    if (!confirm("Delete this reference script?")) return;
    const res = await fetch(
      `/api/drama/clip-libraries/${libraryId}/reference-scripts/${refId}`,
      { method: "DELETE" },
    );
    if (res.ok) await refreshReferences();
  };

  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: "120", libraryId });
      if (statusFilter) qs.set("status", statusFilter);
      const res = await fetch(`/api/drama/stock-library?${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as SnapshotResponse;
      setSnapshot(data);
    } catch {
      /* ignore */
    }
  }, [statusFilter, libraryId]);

  const refreshLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/drama/stock-library/logs?lines=300", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as LogsResponse;
      setLogs(data.lines ?? []);
      const el = logBoxRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLogs();
    const a = setInterval(refresh, 3000);
    const b = setInterval(refreshLogs, 2500);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh, refreshLogs]);

  const startBootstrap = async () => {
    const count = Number(bootstrapCount);
    const batchSize = Number(bootstrapBatchSize);
    if (!Number.isFinite(count) || count <= 0) {
      setBootstrapMessage("Count must be a positive number.");
      return;
    }
    setBootstrapMessage("Submitting…");
    try {
      const res = await fetch("/api/drama/stock-library/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, batchSize, libraryId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBootstrapMessage(`Failed: ${data.error ?? "unknown"}`);
        return;
      }
      setTarget(count);
      setBootstrapMessage(
        `Started: ${count} prompts in flight, batch size ${batchSize}.`,
      );
    } catch (err) {
      setBootstrapMessage(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const saveLibrarySettings = async () => {
    setSavingLib(true);
    setLibSaveMessage(null);
    try {
      const res = await fetch(`/api/drama/clip-libraries/${libraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lib.name,
          character_block: lib.character_block,
          script_prompt: lib.script_prompt,
          music_mode: lib.music_mode,
          music_volume_db: lib.music_volume_db,
          use_reference_scripts: lib.use_reference_scripts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLibSaveMessage(`Save failed: ${data.error ?? "unknown"}`);
        return;
      }
      setLibSaveMessage("Saved.");
    } catch (err) {
      setLibSaveMessage(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSavingLib(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const counts = snapshot?.counts ?? {
    queued: 0,
    generating: 0,
    ready: 0,
    failed: 0,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: 24,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link
          href={`/jobs/create/${format}/clip-library`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "#cdc3d7",
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            arrow_back
          </span>
          All libraries
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          movie_filter
        </span>
        <h1
          style={{ fontSize: 22, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          {lib.name}
        </h1>
      </div>

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <CountTile label="Ready" value={counts.ready} color="#4ade80" />
          <CountTile
            label="Generating"
            value={counts.generating}
            color="#60a5fa"
          />
          <CountTile label="Queued" value={counts.queued} color="#facc15" />
          <CountTile label="Failed" value={counts.failed} color="#f87171" />
          <CountTile
            label="Last ready"
            value={timeAgo(snapshot?.last_ready_at ?? null)}
            color="#e5e2e1"
          />
          <CountTile
            label="Last hour"
            value={snapshot?.ready_last_hour ?? 0}
            color="#e5e2e1"
            sub="clips ready/h"
          />
        </div>
        <ProgressBar
          ready={counts.ready}
          generating={counts.generating}
          queued={counts.queued}
          failed={counts.failed}
          target={target}
        />
      </GlassCard>

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            letterSpacing: 0.5,
          }}
        >
          Library settings
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}>
            NAME
          </label>
          <input
            value={lib.name}
            onChange={(e) => setLib({ ...lib, name: e.target.value })}
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}>
            CHARACTER BLOCK
          </label>
          <textarea
            value={lib.character_block}
            onChange={(e) =>
              setLib({ ...lib, character_block: e.target.value })
            }
            rows={3}
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}>
            SCRIPT PROMPT (used when auto-script is enabled)
          </label>
          <textarea
            value={lib.script_prompt}
            onChange={(e) => setLib({ ...lib, script_prompt: e.target.value })}
            rows={5}
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label
              style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
            >
              MUSIC MODE
            </label>
            <select
              value={lib.music_mode}
              onChange={(e) => setLib({ ...lib, music_mode: e.target.value })}
              style={{
                padding: "8px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 14,
                width: 220,
              }}
            >
              <option value="generate">Generate new (Suno API)</option>
              <option value="library">Reuse from music library</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label
              style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
            >
              MUSIC VOLUME (dB) — {lib.music_volume_db}
            </label>
            <input
              type="range"
              min={-60}
              max={0}
              value={lib.music_volume_db}
              onChange={(e) =>
                setLib({ ...lib, music_volume_db: Number(e.target.value) })
              }
              style={{ width: 220 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={saveLibrarySettings}
            disabled={savingLib}
            style={{
              padding: "8px 18px",
              background: "rgba(var(--v2-accent-rgb),0.18)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.45)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
              cursor: savingLib ? "wait" : "pointer",
            }}
          >
            {savingLib ? "SAVING…" : "SAVE SETTINGS"}
          </button>
          {libSaveMessage && (
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              {libSaveMessage}
            </span>
          )}
        </div>
      </GlassCard>

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            Reference scripts ({references.length})
          </h2>
          <button
            type="button"
            onClick={() =>
              setLib({
                ...lib,
                use_reference_scripts: !lib.use_reference_scripts,
              })
            }
            style={{
              padding: "6px 14px",
              background: lib.use_reference_scripts
                ? "rgba(var(--v2-accent-rgb),0.18)"
                : "rgba(255,255,255,0.03)",
              border: lib.use_reference_scripts
                ? "1px solid rgba(var(--v2-accent-rgb),0.45)"
                : "1px solid rgba(var(--v2-accent-rgb),0.12)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {lib.use_reference_scripts ? "USING REFERENCES" : "REFERENCES OFF"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          When auto-script runs and references are ON, the writer picks the
          least-recently-used reference as a stylistic guide. Double-click any
          row to view the full script. Toggle off to disable references (the
          writer then only sees the system prompt + the topic).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {references.length === 0 && (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: "#cdc3d7",
                fontSize: 12,
              }}
            >
              No reference scripts yet. Add one below.
            </div>
          )}
          {references.map((r) => (
            <div
              key={r.id}
              onDoubleClick={() => openPreview(r.id)}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                borderRadius: 6,
                padding: 10,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#e5e2e1",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: "#cdc3d7" }}>
                  {r.word_count.toLocaleString()} words ·{" "}
                  {r.last_used_at
                    ? `last used ${timeAgo(r.last_used_at)}`
                    : "never used"}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview(r.id);
                }}
                style={{
                  padding: "4px 10px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                VIEW
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteReferenceScript(r.id);
                }}
                style={{
                  padding: "4px 10px",
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  borderRadius: 6,
                  color: "#f87171",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                DELETE
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingTop: 12,
            borderTop: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          }}
        >
          <div style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}>
            ADD NEW REFERENCE
          </div>
          <input
            value={newRefName}
            onChange={(e) => setNewRefName(e.target.value)}
            placeholder="Script name (e.g. 'Jamal — wedding twist')"
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 13,
            }}
          />
          <textarea
            value={newRefContent}
            onChange={(e) => setNewRefContent(e.target.value)}
            rows={4}
            placeholder="Paste the full script text here…"
            style={{
              padding: "8px 10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 12,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <button
            type="button"
            onClick={addReferenceScript}
            disabled={addingRef || !newRefName.trim() || !newRefContent.trim()}
            style={{
              alignSelf: "flex-start",
              padding: "8px 18px",
              background: "rgba(var(--v2-accent-rgb),0.18)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.45)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
              cursor: addingRef ? "wait" : "pointer",
              opacity: !newRefName.trim() || !newRefContent.trim() ? 0.5 : 1,
            }}
          >
            {addingRef ? "ADDING…" : "ADD REFERENCE"}
          </button>
        </div>
      </GlassCard>

      {previewRefId && (
        <div
          onClick={() => {
            setPreviewRefId(null);
            setPreviewContent(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a1a",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 920,
              width: "100%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#e5e2e1",
                }}
              >
                {references.find((r) => r.id === previewRefId)?.name ??
                  "Reference"}
              </span>
              <button
                onClick={() => {
                  setPreviewRefId(null);
                  setPreviewContent(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#cdc3d7",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 0,
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                background: "rgba(0,0,0,0.3)",
                borderRadius: 6,
                padding: 16,
                fontSize: 13,
                color: "#cdc3d7",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {previewContent ?? "Loading…"}
            </div>
          </div>
        </div>
      )}

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
            letterSpacing: 0.5,
          }}
        >
          Launch bootstrap
        </h2>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          Generates N scene prompts via Gemini scoped to this library and
          enqueues each to the VEO worker. Stays on this page; bar fills as they
          land.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label
              style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
            >
              COUNT
            </label>
            <input
              value={bootstrapCount}
              onChange={(e) => setBootstrapCount(e.target.value)}
              style={{
                width: 120,
                padding: "8px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 14,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label
              style={{ fontSize: 11, color: "#cdc3d7", letterSpacing: 0.5 }}
            >
              BATCH SIZE (Gemini)
            </label>
            <input
              value={bootstrapBatchSize}
              onChange={(e) => setBootstrapBatchSize(e.target.value)}
              style={{
                width: 120,
                padding: "8px 10px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                fontSize: 14,
              }}
            />
          </div>
          <button
            onClick={startBootstrap}
            style={{
              padding: "10px 22px",
              background: "rgba(var(--v2-accent-rgb),0.18)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.45)",
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            FIRE BOOTSTRAP
          </button>
          {bootstrapMessage && (
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              {bootstrapMessage}
            </span>
          )}
        </div>
      </GlassCard>

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            Recent clips ({snapshot?.recent.length ?? 0})
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {(["", "ready", "generating", "queued", "failed"] as const).map(
              (s) => (
                <button
                  key={s || "all"}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: "4px 10px",
                    background:
                      statusFilter === s
                        ? "rgba(var(--v2-accent-rgb),0.18)"
                        : "rgba(255,255,255,0.03)",
                    border:
                      statusFilter === s
                        ? "1px solid rgba(var(--v2-accent-rgb),0.45)"
                        : "1px solid rgba(var(--v2-accent-rgb),0.12)",
                    borderRadius: 6,
                    color: "#e5e2e1",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {s || "all"}
                </button>
              ),
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: activeClipId ? "1fr 1fr" : "1fr",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(snapshot?.recent ?? []).map((row) => {
              const isOpen = expanded.has(row.id);
              return (
                <div
                  key={row.id}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                    }}
                    onClick={() => toggleExpand(row.id)}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <StatusChip status={row.status} />
                      {row.vibe_tag && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--v2-accent)",
                            background: "rgba(var(--v2-accent-rgb),0.08)",
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}
                        >
                          {row.vibe_tag}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          color: "#cdc3d7",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.prompt.slice(0, 120)}
                        {row.prompt.length > 120 ? "…" : ""}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      {row.status === "ready" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveClipId(row.id);
                          }}
                          style={{
                            padding: "4px 10px",
                            background: "rgba(74,222,128,0.12)",
                            border: "1px solid rgba(74,222,128,0.35)",
                            borderRadius: 6,
                            color: "#4ade80",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          PLAY
                        </button>
                      )}
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, color: "#cdc3d7" }}
                      >
                        {isOpen ? "expand_less" : "expand_more"}
                      </span>
                    </div>
                  </div>
                  {isOpen && (
                    <div
                      style={{
                        background: "rgba(0,0,0,0.2)",
                        padding: 10,
                        borderRadius: 6,
                        fontSize: 12,
                        color: "#cdc3d7",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {row.prompt}
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          gap: 12,
                          fontSize: 11,
                          color: "rgba(205,195,215,0.7)",
                        }}
                      >
                        <span>origin: {row.origin}</span>
                        <span>dur: {row.duration_sec.toFixed(2)}s</span>
                        <span>
                          created:{" "}
                          {row.created_at
                            ? new Date(row.created_at).toLocaleString()
                            : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(snapshot?.recent.length ?? 0) === 0 && (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "#cdc3d7",
                  fontSize: 13,
                }}
              >
                No clips in this library yet.
              </div>
            )}
          </div>

          {activeClipId && (
            <div
              style={{
                position: "sticky",
                top: 12,
                alignSelf: "start",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "rgba(0,0,0,0.25)",
                padding: 12,
                borderRadius: 8,
                border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{ fontSize: 12, fontWeight: 600, color: "#e5e2e1" }}
                >
                  Preview
                </span>
                <button
                  onClick={() => setActiveClipId(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#cdc3d7",
                    cursor: "pointer",
                    fontSize: 18,
                    padding: 0,
                  }}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <video
                key={activeClipId}
                src={`/api/drama/stock-library/clip/${activeClipId}`}
                controls
                autoPlay
                style={{ width: "100%", borderRadius: 6, background: "#000" }}
              />
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
              letterSpacing: 0.5,
            }}
          >
            Live logs (worker-orchestrator)
          </h2>
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            polls every 2.5 s · filtered to stock + VEO lines
          </span>
        </div>
        <div
          ref={logBoxRef}
          style={{
            background: "#0a0a0a",
            border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
            borderRadius: 6,
            padding: 10,
            maxHeight: 360,
            overflowY: "auto",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: 11,
            color: "#cdc3d7",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {logs.length === 0
            ? "(waiting for log output...)"
            : logs.map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: /error|FAIL/i.test(line)
                      ? "#f87171"
                      : /warn|UNUSUAL/i.test(line)
                        ? "#facc15"
                        : /Stock clip ready|VPS video gen complete/i.test(line)
                          ? "#4ade80"
                          : "#cdc3d7",
                  }}
                >
                  {line}
                </div>
              ))}
        </div>
      </GlassCard>
    </div>
  );
}
