"use client";

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  Pill,
  Select,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  inputStyle,
} from "./ui";
import {
  formatDuration,
  type MusicAssignmentRow,
  type MusicCollectionSummary,
  type MusicTrack,
} from "./types";

const SELECTION_MODES = [
  { value: "random", label: "Random" },
  { value: "sequential", label: "Sequential" },
  { value: "longest_first", label: "Longest first" },
];

/**
 * Collections and their bindings to formats/channels.
 *
 * Same model as the subtitle system: a named bundle is bound to a scope, and
 * the most specific active binding wins —
 * format + channel > channel > format > global default.
 */
export function AssignmentsPanel({
  tracks,
  selectedTrackIds,
  onClearSelection,
}: {
  tracks: MusicTrack[];
  selectedTrackIds: string[];
  onClearSelection: () => void;
}) {
  const [collections, setCollections] = useState<MusicCollectionSummary[]>([]);
  const [assignments, setAssignments] = useState<MusicAssignmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [asgCollection, setAsgCollection] = useState("");
  const [asgFormat, setAsgFormat] = useState("");
  const [asgChannel, setAsgChannel] = useState("");
  const [asgMode, setAsgMode] = useState("random");
  const [asgVolume, setAsgVolume] = useState("-18");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [cRes, aRes] = await Promise.all([
        fetch("/api/music-library/collections", { cache: "no-store" }),
        fetch("/api/music-library/assignments", { cache: "no-store" }),
      ]);
      if (cRes.ok) {
        const d = (await cRes.json()) as {
          collections?: MusicCollectionSummary[];
        };
        setCollections(d.collections ?? []);
      }
      if (aRes.ok) {
        const d = (await aRes.json()) as {
          assignments?: MusicAssignmentRow[];
        };
        setAssignments(d.assignments ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createCollection = async () => {
    if (!newName.trim()) {
      setError("Give the collection a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/music-library/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trackIds: selectedTrackIds,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to create collection");
        return;
      }
      setNewName("");
      onClearSelection();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveAssignment = async () => {
    if (!asgCollection) {
      setError("Pick a collection to assign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/music-library/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: asgCollection,
          format: asgFormat.trim() || null,
          channelId: asgChannel.trim() || null,
          selectionMode: asgMode,
          volumeDb: Number(asgVolume),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to save assignment");
        return;
      }
      setAsgFormat("");
      setAsgChannel("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/music-library/assignments?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to remove");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = (a: MusicAssignmentRow) => {
    if (a.format && a.channel_id) return `${a.format} · channel`;
    if (a.channel_id) return "channel";
    if (a.format) return a.format;
    return "global default";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Collections */}
      <GlassCard style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Icon name="queue_music" size={18} color="var(--v2-accent)" />
          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: 0 }}>
            Collections
          </h3>
        </div>
        <p
          style={{ fontSize: 11, color: TEXT_FAINT, margin: "0 0 14px", maxWidth: 620 }}
        >
          A named bundle of tracks. Formats get assigned a collection rather
          than a single track, so a video series has variety without anyone
          picking a track per job.
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field
              label="New collection"
              hint={
                selectedTrackIds.length > 0
                  ? `${selectedTrackIds.length} selected track(s) will be added.`
                  : "Select tracks in the Library tab to seed it."
              }
            >
              <input
                style={inputStyle}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Calm narration beds"
              />
            </Field>
          </div>
          <Button variant="primary" onClick={createCollection} disabled={busy}>
            <Icon name="add" size={14} />
            Create
          </Button>
        </div>

        {collections.length === 0 ? (
          <EmptyState
            icon="queue_music"
            title="No collections yet"
            detail="Create one to bind music to a format or channel."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {collections.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: TEXT,
                    flex: 1,
                    minWidth: 140,
                  }}
                >
                  {c.name}
                </span>
                <Pill>{c.track_count} tracks</Pill>
                <Pill tone="accent">{formatDuration(c.total_seconds)}</Pill>
                {!c.is_active && <Pill tone="danger">inactive</Pill>}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Assignments */}
      <GlassCard style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Icon name="link" size={18} color="var(--v2-accent)" />
          <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: 0 }}>
            Assignments
          </h3>
        </div>
        <p
          style={{ fontSize: 11, color: TEXT_FAINT, margin: "0 0 14px", maxWidth: 620 }}
        >
          Which collection a format or channel draws from. Leave both blank for
          the global default. Resolution order: format + channel &gt; channel
          &gt; format &gt; global default.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            alignItems: "end",
            marginBottom: 16,
          }}
        >
          <Field label="Collection">
            <Select
              value={asgCollection}
              onChange={setAsgCollection}
              placeholder="Pick one"
              options={collections.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          </Field>
          <Field label="Format" hint="Blank = any">
            <input
              style={inputStyle}
              value={asgFormat}
              onChange={(e) => setAsgFormat(e.target.value)}
              placeholder="CASUALLY_EXPLAINED"
            />
          </Field>
          <Field label="Channel ID" hint="Blank = any">
            <input
              style={inputStyle}
              value={asgChannel}
              onChange={(e) => setAsgChannel(e.target.value)}
              placeholder="uuid"
            />
          </Field>
          <Field label="Selection">
            <Select
              value={asgMode}
              onChange={setAsgMode}
              options={SELECTION_MODES}
            />
          </Field>
          <Field label="Bed volume (dB)">
            <input
              type="number"
              min={-60}
              max={0}
              style={inputStyle}
              value={asgVolume}
              onChange={(e) => setAsgVolume(e.target.value)}
            />
          </Field>
          <Button variant="primary" onClick={saveAssignment} disabled={busy}>
            <Icon name="save" size={14} />
            Assign
          </Button>
        </div>

        {assignments.length === 0 ? (
          <EmptyState
            icon="link_off"
            title="Nothing assigned"
            detail="Until a format has an assignment (or a global default exists), the resolver returns no music rather than guessing a random track."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {assignments.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Pill tone={a.format || a.channel_id ? "accent" : "neutral"}>
                  {scopeLabel(a)}
                </Pill>
                <Icon name="arrow_forward" size={14} color={TEXT_FAINT} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: TEXT,
                    flex: 1,
                    minWidth: 120,
                  }}
                >
                  {a.collection_name}
                </span>
                <span style={{ fontSize: 11, color: TEXT_DIM }}>
                  {a.selection_mode} · {a.volume_db} dB
                </span>
                {!a.is_active && <Pill tone="danger">inactive</Pill>}
                <Button
                  variant="danger"
                  onClick={() => removeAssignment(a.id)}
                  disabled={busy}
                >
                  <Icon name="delete" size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <span style={{ fontSize: 10, color: TEXT_FAINT }}>
        {tracks.length} tracks available to assign.
      </span>
    </div>
  );
}
