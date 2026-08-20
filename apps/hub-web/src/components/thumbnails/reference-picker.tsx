"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  archetypeImageUrl,
  thumbnailImageUrl,
  type ThumbnailArchetype,
  type Thumbnail,
} from "./types";

/**
 * ReferencePicker — choose i2i reference images from three sources:
 *   1. Upload a file (drag & drop or click)
 *   2. Reuse a previously GENERATED thumbnail  ← the explicitly requested one
 *   3. Reuse another archetype's reference image
 *
 * Selections are returned as absolute server paths, which is what the worker
 * feeds to the media gateway. Preview URLs are tracked alongside so the picker
 * can show what was chosen without another round-trip.
 */

export interface PickedReference {
  /** Absolute server path — what generation actually consumes. */
  path: string;
  /** URL for displaying it in the browser. */
  previewUrl: string;
  label: string;
}

interface Props {
  value: PickedReference[];
  onChange: (refs: PickedReference[]) => void;
  archetypes: ThumbnailArchetype[];
  max?: number;
  label?: string;
  /** Single-select mode for the primary reference. */
  single?: boolean;
}

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

type Source = "upload" | "thumbnails" | "archetypes";

export function ReferencePicker({
  value,
  onChange,
  archetypes,
  max = 4,
  label = "Reference images",
  single = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("thumbnails");
  const [library, setLibrary] = useState<Thumbnail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const limit = single ? 1 : max;

  const loadLibrary = useCallback(async () => {
    if (library) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/thumbnails/library?completedOnly=true&limit=60",
      );
      if (!res.ok) throw new Error(`Library request failed (${res.status})`);
      const json = await res.json();
      setLibrary(json.thumbnails ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [library]);

  useEffect(() => {
    if (open && source === "thumbnails") void loadLibrary();
  }, [open, source, loadLibrary]);

  function add(ref: PickedReference) {
    if (single) {
      onChange([ref]);
      setOpen(false);
      return;
    }
    if (value.some((v) => v.path === ref.path)) return;
    if (value.length >= limit) return;
    onChange([...value, ref]);
  }

  function remove(path: string) {
    onChange(value.filter((v) => v.path !== path));
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/thumbnails/upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error ?? `Upload failed (${res.status})`);
      add({
        path: json.path,
        previewUrl: URL.createObjectURL(file),
        label: file.name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: TEXT_2,
          }}
        >
          {label}
          {!single && (
            <span style={{ marginLeft: 6, opacity: 0.6 }}>
              {value.length}/{limit}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            borderRadius: 6,
            background: "rgba(var(--v2-accent-rgb), 0.12)",
            border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
            color: "var(--v2-accent)",
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {open ? "close" : "add_photo_alternate"}
          </span>
          {open ? "Close" : "Add"}
        </button>
      </div>

      {/* Selected */}
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {value.map((ref) => (
            <div
              key={ref.path}
              style={{
                position: "relative",
                width: 92,
                borderRadius: 6,
                overflow: "hidden",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.35)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ref.previewUrl}
                alt={ref.label}
                title={ref.label}
                style={{
                  width: "100%",
                  height: 52,
                  objectFit: "cover",
                  display: "block",
                  background: "rgba(255,255,255,0.05)",
                }}
              />
              <button
                type="button"
                onClick={() => remove(ref.path)}
                title="Remove"
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: "none",
                  background: "rgba(0,0,0,0.72)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 13 }}
                >
                  close
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: "#ff8a8a" }}>{error}</div>}

      {open && (
        <div
          style={{
            borderRadius: 10,
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            background: "rgba(255,255,255,0.03)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 6,
              borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.14)",
            }}
          >
            {(
              [
                ["thumbnails", "Generated", "history"],
                ["archetypes", "Archetypes", "grid_view"],
                ["upload", "Upload", "upload"],
              ] as Array<[Source, string, string]>
            ).map(([id, text, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "none",
                  background:
                    source === id
                      ? "rgba(var(--v2-accent-rgb), 0.18)"
                      : "transparent",
                  color: source === id ? "var(--v2-accent)" : TEXT_2,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  {icon}
                </span>
                {text}
              </button>
            ))}
          </div>

          <div style={{ padding: 10, maxHeight: 260, overflowY: "auto" }}>
            {source === "upload" && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void upload(f);
                }}
                onClick={() => fileRef.current?.click()}
                style={{
                  padding: "26px 16px",
                  borderRadius: 8,
                  border: "1.5px dashed rgba(var(--v2-accent-rgb), 0.32)",
                  textAlign: "center",
                  cursor: "pointer",
                  color: TEXT_2,
                  fontSize: 12,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 26,
                    color: "var(--v2-accent)",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  {uploading ? "hourglass_top" : "cloud_upload"}
                </span>
                {uploading
                  ? "Uploading…"
                  : "Drop an image here, or click to browse"}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {source === "thumbnails" && (
              <>
                {loading && (
                  <div style={{ fontSize: 12, color: TEXT_2 }}>Loading…</div>
                )}
                {!loading && library && library.length === 0 && (
                  <div style={{ fontSize: 12, color: TEXT_2 }}>
                    No generated thumbnails yet. Generate one and it becomes
                    reusable here.
                  </div>
                )}
                <Grid>
                  {(library ?? [])
                    .filter((t) => t.output_path)
                    .map((t) => (
                      <Tile
                        key={t.id}
                        url={thumbnailImageUrl(t.id)}
                        caption={t.title ?? t.headline_text ?? "Untitled"}
                        onClick={() =>
                          add({
                            path: t.output_path!,
                            previewUrl: thumbnailImageUrl(t.id),
                            label: t.title ?? "Generated thumbnail",
                          })
                        }
                      />
                    ))}
                </Grid>
              </>
            )}

            {source === "archetypes" && (
              <Grid>
                {archetypes.map((a) => (
                  <Tile
                    key={a.id}
                    url={archetypeImageUrl(a.id)}
                    caption={a.name}
                    onClick={() =>
                      add({
                        path: a.reference_image_path,
                        previewUrl: archetypeImageUrl(a.id),
                        label: a.name,
                      })
                    }
                  />
                ))}
              </Grid>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function Tile({
  url,
  caption,
  onClick,
}: {
  url: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={caption}
      style={{
        padding: 0,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.04)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption}
        style={{
          width: "100%",
          height: 58,
          objectFit: "cover",
          display: "block",
        }}
      />
      <span
        style={{
          display: "block",
          padding: "4px 6px",
          fontSize: 10,
          color: TEXT_1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {caption}
      </span>
    </button>
  );
}
