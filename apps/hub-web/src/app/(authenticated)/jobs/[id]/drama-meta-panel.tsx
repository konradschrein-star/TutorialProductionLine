"use client";

import { useState } from "react";
import { GlassCard } from "../../_components/glass-card";

interface MusicBed {
  path?: string;
  mode?: "generate" | "library";
  volume_db?: number;
  tracks?: Array<{
    file_path: string;
    duration_seconds: number;
    library_id?: string | null;
  }>;
}

interface ReferenceScriptRef {
  id?: string;
  name?: string;
}

interface HookWriteback {
  count?: number;
}

interface Props {
  jobId: string;
  metadata: Record<string, unknown> | null;
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DramaMetaPanel({ jobId, metadata }: Props) {
  const [refContent, setRefContent] = useState<string | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  if (!metadata) return null;

  const musicBed = metadata["drama_music_bed"] as MusicBed | null | undefined;
  const refScript = metadata["reference_script"] as
    | ReferenceScriptRef
    | null
    | undefined;
  const hookWriteback = metadata["drama_hook_writeback"] as
    | HookWriteback
    | undefined;
  const libraryId = metadata["clip_library_id"] as string | null;
  const renderMode = (metadata["render_mode"] as string) ?? "—";

  const openRefPreview = async () => {
    if (!refScript?.id || !libraryId) return;
    setRefOpen(true);
    setRefContent(null);
    setRefLoading(true);
    try {
      const res = await fetch(
        `/api/drama/clip-libraries/${libraryId}/reference-scripts/${refScript.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setRefContent(`Failed to load: HTTP ${res.status}`);
      } else {
        const data = (await res.json()) as { script: { content: string } };
        setRefContent(data.script.content);
      }
    } catch (e) {
      setRefContent(e instanceof Error ? e.message : String(e));
    } finally {
      setRefLoading(false);
    }
  };

  // Hide the whole block if there's nothing to show.
  if (!musicBed && !refScript && !hookWriteback?.count) {
    return null;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
      }}
    >
      {/* Render mode */}
      <GlassCard
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "#cdc3d7",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Render mode
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e2e1" }}>
          {renderMode}
        </span>
        {hookWriteback?.count != null && (
          <span style={{ fontSize: 11, color: "#cdc3d7" }}>
            {hookWriteback.count} hook clip
            {hookWriteback.count === 1 ? "" : "s"} written back to library
          </span>
        )}
      </GlassCard>

      {/* Music bed */}
      {musicBed && musicBed.tracks && musicBed.tracks.length > 0 && (
        <GlassCard
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "#cdc3d7",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              Music bed · {musicBed.mode ?? "—"} · {musicBed.volume_db ?? "—"}{" "}
              dB
            </span>
            <span style={{ fontSize: 11, color: "#cdc3d7" }}>
              {musicBed.tracks.length} track
              {musicBed.tracks.length === 1 ? "" : "s"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {musicBed.tracks.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 4,
                  fontSize: 11,
                  color: "#cdc3d7",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Track {i + 1} · {fmtDur(t.duration_seconds)}
                  {t.library_id ? " · library" : ""}
                </span>
                {t.library_id && (
                  <a
                    href={`/api/drama/music-library/track/${t.library_id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "var(--v2-accent)",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    PLAY
                  </a>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Reference script */}
      {refScript?.id && (
        <GlassCard
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#cdc3d7",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Reference script used
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e2e1" }}>
            {refScript.name ?? refScript.id}
          </span>
          <button
            type="button"
            onClick={openRefPreview}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px",
              background: "rgba(var(--v2-accent-rgb),0.18)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.45)",
              borderRadius: 6,
              color: "#e5e2e1",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              cursor: "pointer",
            }}
          >
            VIEW FULL SCRIPT
          </button>
        </GlassCard>
      )}

      {/* Reference modal */}
      {refOpen && (
        <div
          onClick={() => {
            setRefOpen(false);
            setRefContent(null);
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
                {refScript?.name ?? "Reference script"}
              </span>
              <button
                onClick={() => {
                  setRefOpen(false);
                  setRefContent(null);
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
              {refLoading ? "Loading…" : (refContent ?? "(no content)")}
            </div>
          </div>
        </div>
      )}

      <span style={{ display: "none" }}>{jobId}</span>
    </div>
  );
}
