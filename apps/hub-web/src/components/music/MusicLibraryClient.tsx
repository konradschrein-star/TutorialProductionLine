"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import { MusicUploadCard } from "./MusicUploadCard";
import { TrackRow } from "./TrackRow";
import { GenerateCard } from "./GenerateCard";
import { AssignmentsPanel } from "./AssignmentsPanel";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  Label,
  Select,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  inputStyle,
} from "./ui";
import {
  SOURCE_LABELS,
  formatDuration,
  type MusicFacets,
  type MusicTrack,
} from "./types";

const EMPTY_FACETS: MusicFacets = {
  genres: [],
  creators: [],
  sources: [],
  formats: [],
  moods: [],
  tags: [],
};

/**
 * The global music library.
 *
 * One pool of tracks that every content format draws from. The metadata that
 * matters most here is `creator` — it is what makes automatic artist credits
 * possible once production scales.
 */
export function MusicLibraryClient() {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [facets, setFacets] = useState<MusicFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [credits, setCredits] = useState<string | null>(null);
  const [tab, setTab] = useState<"library" | "generate" | "assignments">(
    "library",
  );

  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [creator, setCreator] = useState("");
  const [source, setSource] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (genre) params.set("genre", genre);
      if (creator) params.set("creator", creator);
      if (source) params.set("source", source);
      params.set("includeInactive", "1");

      const res = await fetch(`/api/music-library?${params}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        tracks?: MusicTrack[];
        facets?: MusicFacets;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Failed to load library (HTTP ${res.status})`);
        return;
      }
      setTracks(data.tracks ?? []);
      setFacets(data.facets ?? EMPTY_FACETS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [q, genre, creator, source]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const stats = useMemo(() => {
    const totalSeconds = tracks.reduce((a, t) => a + t.duration_seconds, 0);
    const missingCreator = tracks.filter((t) => !t.creator).length;
    return { totalSeconds, missingCreator };
  }, [tracks]);

  const toggle = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCredits = async () => {
    setError(null);
    setCredits(null);
    try {
      const res = await fetch("/api/music-library/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackIds: Array.from(selectedIds) }),
      });
      const data = (await res.json()) as {
        text?: string;
        blocked?: boolean;
        unattributable?: Array<{ name: string; reason: string }>;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to build credits");
        return;
      }
      if (data.blocked) {
        setError(
          `Cannot publish these credits yet — ${data.unattributable
            ?.map((u) => `"${u.name}" (${u.reason})`)
            .join("; ")}`,
        );
      }
      setCredits(data.text || "(nothing to credit for this selection)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build credits");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: TEXT,
            margin: 0,
            marginBottom: 4,
          }}
        >
          Music Library
        </h1>
        <p style={{ fontSize: 12, color: TEXT_DIM, margin: 0 }}>
          One global pool of background music and soundtracks, shared by every
          content format.
        </p>
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {/* Overview */}
      <GlassCard
        style={{
          padding: 16,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Stat label="Tracks" value={tracks.length.toLocaleString()} />
        <Stat
          label="Total runtime"
          value={formatDuration(stats.totalSeconds)}
        />
        <Stat
          label="Missing creator"
          value={stats.missingCreator.toLocaleString()}
          warn={stats.missingCreator > 0}
        />
      </GlassCard>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
        }}
      >
        {(
          [
            ["library", "Library", "library_music"],
            ["generate", "Generate", "auto_awesome"],
            ["assignments", "Assignments", "link"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "9px 14px",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${
                tab === key ? "var(--v2-accent)" : "transparent"
              }`,
              color: tab === key ? TEXT : TEXT_FAINT,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: -1,
            }}
          >
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === "generate" && <GenerateCard onChanged={() => void load()} />}

      {tab === "assignments" && (
        <AssignmentsPanel
          tracks={tracks}
          selectedTrackIds={Array.from(selectedIds)}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {tab === "library" && (
        <>
      <MusicUploadCard onUploaded={() => void load()} />

      {/* Filters */}
      <GlassCard style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12,
          }}
        >
          <label style={{ display: "block" }}>
            <Label>Search</Label>
            <input
              style={inputStyle}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="name or creator"
            />
          </label>
          <label style={{ display: "block" }}>
            <Label>Creator</Label>
            <Select
              value={creator}
              onChange={setCreator}
              placeholder="Any creator"
              options={facets.creators.map((c) => ({ value: c, label: c }))}
            />
          </label>
          <label style={{ display: "block" }}>
            <Label>Genre</Label>
            <Select
              value={genre}
              onChange={setGenre}
              placeholder="Any genre"
              options={facets.genres.map((g) => ({ value: g, label: g }))}
            />
          </label>
          <label style={{ display: "block" }}>
            <Label>Source</Label>
            <Select
              value={source}
              onChange={setSource}
              placeholder="Any source"
              options={facets.sources.map((s) => ({
                value: s,
                label: SOURCE_LABELS[s] ?? s,
              }))}
            />
          </label>
        </div>
      </GlassCard>

      {/* Selection actions */}
      {selectedIds.size > 0 && (
        <GlassCard
          style={{
            padding: 14,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: TEXT }}>
            {selectedIds.size} selected
          </span>
          <Button onClick={exportCredits}>
            <Icon name="receipt_long" size={14} />
            Build credits
          </Button>
          <Button onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </GlassCard>
      )}

      {credits !== null && (
        <GlassCard style={{ padding: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <Label>Credits block</Label>
            <Button onClick={() => void navigator.clipboard.writeText(credits)}>
              <Icon name="content_copy" size={14} />
              Copy
            </Button>
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              color: TEXT_DIM,
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {credits}
          </pre>
        </GlassCard>
      )}

      {/* Track list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <GlassCard style={{ padding: 24 }}>
            <span style={{ fontSize: 12, color: TEXT_FAINT }}>Loading…</span>
          </GlassCard>
        ) : tracks.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon="library_music"
              title="No tracks match"
              detail="Upload a track above, or generate one with Suno."
            />
          </GlassCard>
        ) : (
          tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              selected={selectedIds.has(track.id)}
              onToggleSelect={() => toggle(track.id)}
              onChanged={() => void load()}
            />
          ))
        )}
      </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: TEXT_FAINT,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: warn ? "#fcd34d" : TEXT,
        }}
      >
        {value}
      </div>
    </div>
  );
}
