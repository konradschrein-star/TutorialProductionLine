"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import {
  Button,
  ErrorBanner,
  Field,
  Icon,
  Label,
  Pill,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  inputStyle,
} from "./ui";
import { formatBytes, formatDuration } from "./types";

const MOOD_OPTIONS = [
  "Upbeat",
  "Energetic",
  "Calm",
  "Dramatic",
  "Suspenseful",
  "Happy",
  "Sad",
  "Inspiring",
  "Dark",
  "Light",
];

const ACCEPTED = [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "opus",
] as const;

/** Common licences for the copyright-free music sourced off YouTube. */
const LICENSE_PRESETS = [
  "Royalty-free — no attribution required",
  "Royalty-free — attribution required",
  "CC BY 4.0",
  "CC BY-SA 4.0",
  "CC0 / Public domain",
  "YouTube Audio Library",
  "Purchased licence",
];

interface UploadState {
  file: File;
  /** Duration read by the browser, shown as an immediate preview. The
   *  authoritative value is the server-side ffprobe on submit. */
  previewDuration: number | null;
  objectUrl: string;
}

export function MusicUploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [selected, setSelected] = useState<UploadState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    creator: "",
    license: "",
    source_url: "",
    attribution_required: false,
    attribution_text: "",
    genre: "",
    format: "",
    bpm: "",
    mood: [] as string[],
    tags: "",
  });

  // Revoke the preview URL when the selection changes or the card unmounts.
  useEffect(() => {
    return () => {
      if (selected) URL.revokeObjectURL(selected.objectUrl);
    };
  }, [selected]);

  const acceptFile = useCallback(
    (file: File) => {
      setError(null);
      setNotice(null);

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!(ACCEPTED as readonly string[]).includes(ext)) {
        setError(
          `"${file.name}" is not a supported audio format. Accepted: ${ACCEPTED.join(", ")}.`,
        );
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const next: UploadState = { file, previewDuration: null, objectUrl };
      setSelected(next);

      // Read the duration locally for instant feedback. This is a preview
      // only — the server re-probes with ffprobe and that value is what is
      // stored, because the browser will happily report a duration for a file
      // that is not really usable.
      const probe = new Audio();
      probe.preload = "metadata";
      probe.src = objectUrl;
      probe.onloadedmetadata = () => {
        setSelected((cur) =>
          cur && cur.file === file
            ? {
                ...cur,
                previewDuration: Number.isFinite(probe.duration)
                  ? probe.duration
                  : null,
              }
            : cur,
        );
      };

      setForm((f) => ({
        ...f,
        name: f.name || file.name.replace(/\.[^.]+$/, ""),
      }));
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) acceptFile(file);
    },
    [acceptFile],
  );

  const clearSelection = () => {
    if (selected) URL.revokeObjectURL(selected.objectUrl);
    setSelected(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) {
      setError("Choose an audio file first.");
      return;
    }
    if (!form.name.trim()) {
      setError("Give the track a name.");
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append("file", selected.file);
      fd.append("name", form.name.trim());
      fd.append("creator", form.creator.trim());
      fd.append("license", form.license.trim());
      fd.append("source_url", form.source_url.trim());
      fd.append(
        "attribution_required",
        form.attribution_required ? "true" : "false",
      );
      fd.append("attribution_text", form.attribution_text.trim());
      fd.append("genre", form.genre.trim());
      fd.append("format", form.format.trim());
      fd.append("bpm", form.bpm.trim());
      fd.append("mood", JSON.stringify(form.mood));
      fd.append(
        "tags",
        JSON.stringify(
          form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      );

      const res = await fetch("/api/music-library", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        error?: string;
        probe?: { durationSeconds: number; codec: string | null };
      };

      if (!res.ok) {
        // Show the server's real reason — "upload failed" alone is useless
        // when the actual cause is "file contains no audio stream".
        setError(data.error ?? `Upload failed (HTTP ${res.status})`);
        return;
      }

      setNotice(
        `Uploaded. Server probe: ${formatDuration(data.probe?.durationSeconds ?? null)}${
          data.probe?.codec ? ` · ${data.probe.codec}` : ""
        }`,
      );
      clearSelection();
      setForm({
        name: "",
        creator: form.creator, // keep — uploads usually come in batches per artist
        license: form.license,
        source_url: "",
        attribution_required: form.attribution_required,
        attribution_text: "",
        genre: form.genre,
        format: form.format,
        bpm: "",
        mood: [],
        tags: "",
      });
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <GlassCard style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <Icon name="upload" size={18} color="var(--v2-accent)" />
        <h3
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: TEXT,
            margin: 0,
            letterSpacing: "0.02em",
          }}
        >
          Upload a track
        </h3>
      </div>

      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `1.5px dashed ${
              dragging
                ? "var(--v2-accent)"
                : "rgba(var(--v2-accent-rgb), 0.28)"
            }`,
            borderRadius: 10,
            padding: selected ? 14 : 28,
            textAlign: "center",
            cursor: "pointer",
            background: dragging
              ? "rgba(var(--v2-accent-rgb), 0.07)"
              : "rgba(255,255,255,0.015)",
            transition: "all 0.15s ease",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
            }}
            style={{ display: "none" }}
          />

          {!selected ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon
                name="library_music"
                size={28}
                style={{ opacity: 0.45, color: TEXT_DIM }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>
                Drop an audio file here, or click to browse
              </span>
              <span style={{ fontSize: 10, color: TEXT_FAINT }}>
                {ACCEPTED.join(" · ")} — up to 200 MB
              </span>
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Icon name="audio_file" size={18} color="var(--v2-accent)" />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: TEXT,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  }}
                >
                  {selected.file.name}
                </span>
                <Pill>{formatBytes(selected.file.size)}</Pill>
                <Pill tone={selected.previewDuration ? "accent" : "neutral"}>
                  {selected.previewDuration
                    ? formatDuration(selected.previewDuration)
                    : "reading…"}
                </Pill>
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{
                    background: "none",
                    border: "none",
                    color: TEXT_FAINT,
                    cursor: "pointer",
                    display: "flex",
                  }}
                  aria-label="Remove file"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <audio
                controls
                src={selected.objectUrl}
                style={{ width: "100%", height: 32 }}
              />
            </div>
          )}
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {notice && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "rgba(80,220,150,0.08)",
              border: "1px solid rgba(80,220,150,0.25)",
              borderRadius: 8,
              fontSize: 12,
              color: "#6ee7b7",
            }}
          >
            <Icon name="check_circle" size={16} />
            {notice}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          <Field label="Track name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle}
              required
            />
          </Field>

          <Field
            label="Creator"
            hint="Who made it. Used to credit artists automatically later."
          >
            <input
              type="text"
              value={form.creator}
              onChange={(e) => setForm({ ...form, creator: e.target.value })}
              style={inputStyle}
              placeholder="e.g. Kevin MacLeod"
              list="music-license-creators"
            />
          </Field>

          <Field label="Licence">
            <input
              type="text"
              value={form.license}
              onChange={(e) => setForm({ ...form, license: e.target.value })}
              style={inputStyle}
              placeholder="e.g. CC BY 4.0"
              list="music-license-presets"
            />
            <datalist id="music-license-presets">
              {LICENSE_PRESETS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>

          <Field label="Source URL" hint="Where you got it — YouTube, artist page.">
            <input
              type="url"
              value={form.source_url}
              onChange={(e) => setForm({ ...form, source_url: e.target.value })}
              style={inputStyle}
              placeholder="https://…"
            />
          </Field>

          <Field label="Genre">
            <input
              type="text"
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
              style={inputStyle}
              placeholder="e.g. ambient"
            />
          </Field>

          <Field label="Format tag" hint="Optional — leave blank for any format.">
            <input
              type="text"
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}
              style={inputStyle}
              placeholder="e.g. CASUALLY_EXPLAINED"
            />
          </Field>

          <Field label="BPM">
            <input
              type="number"
              min={0}
              max={300}
              value={form.bpm}
              onChange={(e) => setForm({ ...form, bpm: e.target.value })}
              style={inputStyle}
            />
          </Field>

          <Field label="Tags" hint="Comma separated.">
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              style={inputStyle}
              placeholder="lofi, piano, loop"
            />
          </Field>
        </div>

        <div>
          <Label>Mood</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MOOD_OPTIONS.map((mood) => {
              const on = form.mood.includes(mood);
              return (
                <button
                  key={mood}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      mood: on
                        ? form.mood.filter((m) => m !== mood)
                        : [...form.mood, mood],
                    })
                  }
                  style={{
                    padding: "5px 11px",
                    background: on
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.03)",
                    border: on
                      ? "none"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                    borderRadius: 6,
                    color: on ? "#000" : TEXT,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {mood}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            background: "rgba(255,255,255,0.015)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
            borderRadius: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 12,
              color: TEXT,
            }}
          >
            <input
              type="checkbox"
              checked={form.attribution_required}
              onChange={(e) =>
                setForm({ ...form, attribution_required: e.target.checked })
              }
            />
            The licence requires the artist to be credited
          </label>

          {form.attribution_required && (
            <Field
              label="Exact credit line (optional)"
              hint="Set this when the licence dictates specific wording. It is used verbatim."
            >
              <input
                type="text"
                value={form.attribution_text}
                onChange={(e) =>
                  setForm({ ...form, attribution_text: e.target.value })
                }
                style={inputStyle}
                placeholder='e.g. Music: "Track" by Artist, licensed under CC BY 4.0'
              />
            </Field>
          )}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Button type="submit" variant="primary" disabled={uploading || !selected}>
            <Icon name={uploading ? "hourglass_top" : "upload"} size={15} />
            {uploading ? "Uploading…" : "Add to library"}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
