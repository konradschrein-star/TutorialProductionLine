"use client";

import { useState } from "react";
import {
  Button,
  ErrorBanner,
  Field,
  Icon,
  Pill,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  inputStyle,
} from "./ui";
import {
  SOURCE_LABELS,
  formatBytes,
  formatDuration,
  type MusicTrack,
} from "./types";

const SOURCE_TONE: Record<
  string,
  "neutral" | "accent" | "warn" | "danger" | "ok"
> = {
  suno_ai33: "accent",
  minimax_ai33: "accent",
  upload: "ok",
  seed: "warn",
  unknown: "danger",
};

export function TrackRow({
  track,
  selected,
  onToggleSelect,
  onChanged,
}: {
  track: MusicTrack;
  selected: boolean;
  onToggleSelect: () => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const [draft, setDraft] = useState({
    name: track.name,
    creator: track.creator ?? "",
    license: track.license ?? "",
    source_url: track.source_url ?? "",
    attribution_required: track.attribution_required,
    attribution_text: track.attribution_text ?? "",
    genre: track.genre ?? "",
    format: track.format ?? "",
    bpm: track.bpm?.toString() ?? "",
    tags: track.tags.join(", "),
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/music-library/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          creator: draft.creator.trim() || null,
          license: draft.license.trim() || null,
          source_url: draft.source_url.trim() || null,
          attribution_required: draft.attribution_required,
          attribution_text: draft.attribution_text.trim() || null,
          genre: draft.genre.trim() || null,
          format: draft.format.trim() || null,
          bpm: draft.bpm.trim() ? Number(draft.bpm) : null,
          tags: draft.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (
      !confirm(
        `Delete "${track.name}"? This removes the row and its audio file.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/music-library/${track.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        error?: string;
        fileDeleted?: boolean;
        fileError?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? "Delete failed");
        return;
      }
      if (data.fileDeleted === false) {
        // Say so rather than pretending the disk is clean.
        console.warn(
          `[music] row deleted but file remained: ${data.fileError ?? "unknown"}`,
        );
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const missingCreator = !track.creator;

  return (
    <div
      style={{
        background: selected
          ? "rgba(var(--v2-accent-rgb), 0.09)"
          : "rgba(255,255,255,0.025)",
        border: `1px solid ${
          selected
            ? "rgba(var(--v2-accent-rgb), 0.4)"
            : "rgba(var(--v2-accent-rgb), 0.12)"
        }`,
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          title="Select for credits export or a collection"
          style={{ cursor: "pointer", flexShrink: 0 }}
        />

        <button
          onClick={() => setPlaying((p) => !p)}
          title={playing ? "Hide player" : "Play"}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: playing
              ? "var(--v2-accent)"
              : "rgba(255,255,255,0.05)",
            border: playing
              ? "none"
              : "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            color: playing ? "#000" : TEXT,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={playing ? "stop" : "play_arrow"} size={18} />
        </button>

        <div style={{ flex: 1, minWidth: 180 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: TEXT,
              marginBottom: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track.name}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 11,
              color: TEXT_DIM,
            }}
          >
            {/* Creator is the headline metadata — front and centre. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: missingCreator ? "#fcd34d" : TEXT_DIM,
                fontWeight: missingCreator ? 600 : 400,
              }}
              title={
                missingCreator
                  ? "No creator recorded — set one so credits can be generated"
                  : undefined
              }
            >
              <Icon name="person" size={13} />
              {track.creator ?? "no creator set"}
            </span>
            <span style={{ color: TEXT_FAINT }}>·</span>
            <span>{formatDuration(track.duration_seconds)}</span>
            {track.genre && (
              <>
                <span style={{ color: TEXT_FAINT }}>·</span>
                <span>{track.genre}</span>
              </>
            )}
            {track.bpm && (
              <>
                <span style={{ color: TEXT_FAINT }}>·</span>
                <span>{track.bpm} BPM</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Pill tone={SOURCE_TONE[track.source] ?? "neutral"}>
            {SOURCE_LABELS[track.source] ?? track.source}
          </Pill>
          {track.attribution_required && (
            <Pill tone="warn" title="Licence requires crediting the artist">
              credit required
            </Pill>
          )}
          {track.format && <Pill tone="accent">{track.format}</Pill>}
          {!track.is_active && <Pill tone="danger">retired</Pill>}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setExpanded((x) => !x)}
            title={expanded ? "Collapse" : "Details"}
            style={iconButtonStyle}
          >
            <Icon name={expanded ? "expand_less" : "expand_more"} size={18} />
          </button>
        </div>
      </div>

      {playing && (
        <audio
          controls
          autoPlay
          src={`/api/music-library/${track.id}/stream`}
          onEnded={() => setPlaying(false)}
          style={{ width: "100%", height: 34 }}
        />
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {expanded && !editing && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingTop: 10,
            borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              fontSize: 11,
            }}
          >
            <Detail label="Licence" value={track.license} />
            <Detail label="Source" value={track.source_url} link />
            <Detail label="Tags" value={track.tags.join(", ") || null} />
            <Detail label="Mood" value={track.mood.join(", ") || null} />
            <Detail label="File size" value={formatBytes(track.file_bytes)} />
            <Detail
              label="Original filename"
              value={track.original_filename}
            />
            <Detail
              label="Added"
              value={new Date(track.created_at).toLocaleString()}
            />
            <Detail label="Path" value={track.file_path} mono />
          </div>

          {track.generation_prompt && (
            <div
              style={{
                padding: 10,
                background: "rgba(var(--v2-accent-rgb), 0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: TEXT_FAINT,
                  marginBottom: 4,
                }}
              >
                Generated from prompt
                {track.generation_task_id
                  ? ` · task ${track.generation_task_id}`
                  : ""}
              </div>
              <div style={{ fontSize: 11, color: TEXT_DIM }}>
                {track.generation_prompt}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} />
              Edit metadata
            </Button>
            <Button variant="danger" onClick={remove}>
              <Icon name="delete" size={14} />
              Delete
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingTop: 10,
            borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <Field label="Name">
              <input
                style={inputStyle}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Creator">
              <input
                style={inputStyle}
                value={draft.creator}
                onChange={(e) =>
                  setDraft({ ...draft, creator: e.target.value })
                }
                placeholder="Who made it"
              />
            </Field>
            <Field label="Licence">
              <input
                style={inputStyle}
                value={draft.license}
                onChange={(e) =>
                  setDraft({ ...draft, license: e.target.value })
                }
              />
            </Field>
            <Field label="Source URL">
              <input
                style={inputStyle}
                value={draft.source_url}
                onChange={(e) =>
                  setDraft({ ...draft, source_url: e.target.value })
                }
              />
            </Field>
            <Field label="Genre">
              <input
                style={inputStyle}
                value={draft.genre}
                onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
              />
            </Field>
            <Field label="Format tag">
              <input
                style={inputStyle}
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value })}
              />
            </Field>
            <Field label="BPM">
              <input
                type="number"
                style={inputStyle}
                value={draft.bpm}
                onChange={(e) => setDraft({ ...draft, bpm: e.target.value })}
              />
            </Field>
            <Field label="Tags">
              <input
                style={inputStyle}
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </Field>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: TEXT,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={draft.attribution_required}
              onChange={(e) =>
                setDraft({ ...draft, attribution_required: e.target.checked })
              }
            />
            Licence requires crediting the artist
          </label>

          {draft.attribution_required && (
            <Field label="Exact credit line (optional)">
              <input
                style={inputStyle}
                value={draft.attribution_text}
                onChange={(e) =>
                  setDraft({ ...draft, attribution_text: e.target.value })
                }
              />
            </Field>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onClick={save} disabled={saving}>
              <Icon name="save" size={14} />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
  color: TEXT_DIM,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function Detail({
  label,
  value,
  link,
  mono,
}: {
  label: string;
  value: string | null;
  link?: boolean;
  mono?: boolean;
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
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {value ? (
        link ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: "var(--v2-accent)",
              wordBreak: "break-all",
            }}
          >
            {value}
          </a>
        ) : (
          <div
            style={{
              fontSize: 11,
              color: TEXT_DIM,
              wordBreak: "break-all",
              fontFamily: mono ? "ui-monospace, monospace" : undefined,
            }}
          >
            {value}
          </div>
        )
      ) : (
        <div style={{ fontSize: 11, color: TEXT_FAINT }}>—</div>
      )}
    </div>
  );
}
