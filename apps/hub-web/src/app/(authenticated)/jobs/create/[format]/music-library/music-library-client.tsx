"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "../../../../_components/glass-card";

interface MusicTrack {
  id: string;
  name: string;
  duration_seconds: number;
  genre: string | null;
  format: string | null;
  created_at: string | null;
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function MusicLibraryClient({
  format,
  formatSlug,
}: {
  format: string;
  formatSlug: string;
}) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    const url = showAll
      ? "/api/drama/music-library"
      : `/api/drama/music-library?format=${format}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { tracks: MusicTrack[] };
      setTracks(data.tracks);
    } catch {
      /* ignore */
    }
  }, [format, showAll]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const totalSec = tracks.reduce((a, b) => a + b.duration_seconds, 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <Link
        href={`/jobs/create/${formatSlug}`}
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
        Back to create
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 28, color: "var(--v2-accent)" }}
        >
          library_music
        </span>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#e5e2e1",
            margin: 0,
          }}
        >
          Music library — {format}
        </h1>
      </div>

      <GlassCard
        style={{
          padding: 16,
          display: "flex",
          gap: 16,
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "#cdc3d7" }}>
          {tracks.length.toLocaleString()} tracks ·{" "}
          {Math.round(totalSec / 60).toLocaleString()} min total
        </span>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          style={{
            padding: "6px 12px",
            background: showAll
              ? "rgba(var(--v2-accent-rgb),0.18)"
              : "rgba(255,255,255,0.03)",
            border: showAll
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
          {showAll ? "SHOWING ALL FORMATS" : "ONLY THIS FORMAT"}
        </button>
      </GlassCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tracks.length === 0 && (
          <GlassCard style={{ padding: 24, textAlign: "center" }}>
            <span style={{ fontSize: 13, color: "#cdc3d7" }}>
              No tracks yet. Music is generated when a drama job assembles with
              music enabled; each track is saved here with format ={" "}
              <code>{format}</code> so it can be reused later.
            </span>
          </GlassCard>
        )}
        {tracks.map((t) => (
          <GlassCard
            key={t.id}
            style={{
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </span>
                <span style={{ fontSize: 11, color: "#cdc3d7" }}>
                  {fmtDur(t.duration_seconds)} · {t.genre ?? "—"} ·{" "}
                  <span
                    style={{
                      color: t.format
                        ? "var(--v2-accent)"
                        : "rgba(205,195,215,0.6)",
                      fontWeight: 600,
                    }}
                  >
                    {t.format ?? "no format tag"}
                  </span>{" "}
                  · {fmtDate(t.created_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPlayingId((p) => (p === t.id ? null : t.id))}
                style={{
                  padding: "6px 14px",
                  background: "rgba(var(--v2-accent-rgb),0.12)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.35)",
                  borderRadius: 6,
                  color: "#e5e2e1",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  cursor: "pointer",
                }}
              >
                {playingId === t.id ? "HIDE" : "PLAY"}
              </button>
            </div>
            {playingId === t.id && (
              <audio
                controls
                autoPlay
                src={`/api/drama/music-library/track/${t.id}`}
                style={{ width: "100%" }}
              />
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
