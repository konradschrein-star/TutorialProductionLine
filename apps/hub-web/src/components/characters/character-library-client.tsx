"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";

/**
 * Character Library.
 *
 * A character is an IDENTITY (this face, reusable across formats and channels).
 * It is deliberately NOT a style — a style is a treatment, and merging the two
 * would make it impossible to render one character in two styles.
 *
 * V2 conventions, matching the neighbouring library pages: inline styles only
 * (no Tailwind), material-symbols glyphs (no lucide), and V2Listbox instead of
 * a native <select> — the OS popup for <select> is unstyleable on Windows
 * Chrome.
 */

export interface LibraryImage {
  id: string;
  image_path: string;
  pose: string | null;
  expression: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface LibraryCharacter {
  id: string;
  name: string;
  description: string;
  role: string;
  notes: string | null;
  is_active: boolean;
  images: LibraryImage[];
  channel_ids: string[];
}

export interface ChannelOption {
  id: string;
  name: string;
}

const TEXT_1 = "var(--v2-text-1)";
const TEXT_2 = "var(--v2-text-2)";

const cardStyle: CSSProperties = {
  border: "1px solid rgba(var(--v2-accent-rgb), 0.16)",
  borderRadius: 12,
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.16)",
  color: TEXT_1,
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: TEXT_2,
  display: "block",
  marginBottom: 6,
};

function btn(kind: "primary" | "ghost" | "danger" = "ghost"): CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border:
      kind === "primary"
        ? "1px solid rgba(var(--v2-accent-rgb), 0.5)"
        : kind === "danger"
          ? "1px solid rgba(255,110,110,0.4)"
          : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
    background:
      kind === "primary"
        ? "rgba(var(--v2-accent-rgb), 0.16)"
        : kind === "danger"
          ? "rgba(255,110,110,0.10)"
          : "rgba(255,255,255,0.04)",
    color:
      kind === "primary"
        ? "var(--v2-accent)"
        : kind === "danger"
          ? "#ff9c9c"
          : TEXT_1,
  };
}

function Glyph({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="material-symbols-outlined"
      style={{ fontSize: size, lineHeight: 1, verticalAlign: "middle" }}
    >
      {name}
    </span>
  );
}

export function CharacterLibraryClient({
  initialCharacters,
  channels,
  characterId,
  canEdit = true,
}: {
  initialCharacters: LibraryCharacter[];
  channels: ChannelOption[];
  characterId?: string;
  canEdit?: boolean;
}) {
  const [characters, setCharacters] =
    useState<LibraryCharacter[]>(initialCharacters);
  const [expanded, setExpanded] = useState<string | null>(characterId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const channelName = useCallback(
    (id: string) => channels.find((c) => c.id === id)?.name ?? id.slice(0, 8),
    [channels],
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/characters/library");
    if (!res.ok) {
      setError(`Reload failed (${res.status})`);
      return;
    }
    const data = await res.json();
    setCharacters((data.characters ?? []).filter((c: LibraryCharacter) => !characterId || c.id === characterId));
  }, [characterId]);

  const create = useCallback(async () => {
    if (!newName.trim() || !newDescription.trim()) {
      setError("A character needs a name and a physical description.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          role: "host",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      setNewName("");
      setNewDescription("");
      setCreating(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }, [newName, newDescription, refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,110,110,0.4)",
            background: "rgba(255,110,110,0.10)",
            color: "#ff9c9c",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {!characterId && canEdit && <button
          type="button"
          style={btn("primary")}
          onClick={() => setCreating((c) => !c)}
        >
          <Glyph name={creating ? "close" : "person_add"} />{" "}
          {creating ? "Cancel" : "New character"}
        </button>}
        <span style={{ fontSize: 12, color: TEXT_2 }}>
          {characters.length} character{characters.length === 1 ? "" : "s"} ·{" "}
          {characters.reduce((n, c) => n + c.images.length, 0)} images
        </span>
      </div>

      {creating && (
        <div style={cardStyle}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. General Guy"
            />
          </div>
          <div>
            <label style={labelStyle}>
              Physical description (goes into every thumbnail prompt)
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Clean-shaven man in his 30s, dark side-swept hair, navy shirt…"
            />
          </div>
          <div>
            <button
              type="button"
              style={btn("primary")}
              disabled={busy === "create"}
              onClick={create}
            >
              {busy === "create" ? "Creating…" : "Create character"}
            </button>
          </div>
        </div>
      )}

      {characters.length === 0 && !creating && (
        <div style={{ ...cardStyle, color: TEXT_2, fontSize: 13 }}>
          No characters yet. A character is the human face a channel uses on its
          thumbnails — create one, add a few photos, and bind it to a channel as
          its host.
        </div>
      )}

      {characters.map((character) => (
        <fieldset key={character.id} disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!canEdit && <legend style={{ color: TEXT_2, fontSize: 12 }}>Read-only character images</legend>}
        <CharacterCard
          key={character.id}
          character={character}
          channels={channels}
          channelName={channelName}
          expanded={!canEdit || expanded === character.id}
          onToggle={() =>
            setExpanded((e) => (e === character.id ? null : character.id))
          }
          onChanged={refresh}
          onError={setError}
        />
        </fieldset>
      ))}
    </div>
  );
}

function CharacterCard({
  character,
  channels,
  channelName,
  expanded,
  onToggle,
  onChanged,
  onError,
}: {
  character: LibraryCharacter;
  channels: ChannelOption[];
  channelName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [description, setDescription] = useState(character.description);
  const [busy, setBusy] = useState<string | null>(null);
  const [addChannel, setAddChannel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const activeImages = useMemo(
    () => character.images.filter((i) => i.is_active),
    [character.images],
  );

  const unboundChannels = useMemo(
    () => channels.filter((c) => !character.channel_ids.includes(c.id)),
    [channels, character.channel_ids],
  );

  const saveDescription = useCallback(async () => {
    setBusy("desc");
    onError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }, [character.id, description, onChanged, onError]);

  const setChannels = useCallback(
    async (ids: string[]) => {
      setBusy("channels");
      onError(null);
      try {
        const res = await fetch(`/api/characters/${character.id}/channels`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channels: ids.map((channel_id) => ({
              channel_id,
              // Existing channel semantics are preserved by the server.
              // New bindings explicitly make this the host of THAT channel.
              ...(!character.channel_ids.includes(channel_id)
                ? { role: "host", is_primary: true } : {}),
            })),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "failed");
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Channel update failed");
      } finally {
        setBusy(null);
      }
    },
    [character.id, character.channel_ids, onChanged, onError],
  );

  const upload = useCallback(
    async (file: File) => {
      setBusy("upload");
      onError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/characters/${character.id}/images`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "failed");
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(null);
      }
    },
    [character.id, onChanged, onError],
  );

  const toggleImage = useCallback(
    async (image: LibraryImage) => {
      setBusy(`img-${image.id}`);
      onError(null);
      try {
        const res = await fetch(`/api/characters/images/${image.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !image.is_active }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "failed");
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setBusy(null);
      }
    },
    [onChanged, onError],
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {activeImages[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/characters/images/${activeImages[0].id}/file`}
            alt=""
            style={{
              width: 84,
              height: 84,
              objectFit: "cover",
              objectPosition: "center 20%",
              borderRadius: 10,
              flexShrink: 0,
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
            }}
          />
        ) : (
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 10,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.05)",
              color: TEXT_2,
            }}
          >
            <Glyph name="person" size={30} />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: TEXT_1 }}>
              {character.name}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(var(--v2-accent-rgb), 0.14)",
                color: "var(--v2-accent)",
              }}
            >
              {character.role}
            </span>
            <span style={{ fontSize: 11.5, color: TEXT_2 }}>
              {activeImages.length} of {character.images.length} images in the
              cycle
            </span>
          </div>
          <p
            style={{
              margin: "6px 0 0 0",
              fontSize: 12.5,
              color: TEXT_2,
              lineHeight: 1.5,
            }}
          >
            {character.description}
          </p>
          <div
            style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}
          >
            {character.channel_ids.length === 0 && (
              <span style={{ fontSize: 11.5, color: "#ffb27a" }}>
                Not bound to any channel — thumbnails will not use this face.
              </span>
            )}
            {character.channel_ids.map((id) => (
              <span
                key={id}
                style={{
                  fontSize: 11,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                  color: TEXT_1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Glyph name="tv" size={13} />
                {channelName(id)}
                <button
                  type="button"
                  title="Unbind"
                  aria-label={`Unbind ${character.name} from ${channelName(id)}`}
                  onClick={() =>
                    setChannels(character.channel_ids.filter((c) => c !== id))
                  }
                  style={{
                    background: "none",
                    border: "none",
                    color: TEXT_2,
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                  }}
                >
                  <Glyph name="close" size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>

        <button type="button" style={btn()} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? 'Close' : 'Manage'} ${character.name} images`}>
          <Glyph name={expanded ? "expand_less" : "expand_more"} />{" "}
          {expanded ? "Close" : "Manage"}
        </button>
      </div>

      {/* Image strip — the cycle, in order. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {character.images.map((img, i) => (
          <div key={img.id} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/characters/images/${img.id}/file`}
              alt={`${character.name} — ${img.pose ?? `image ${i + 1}`}${img.expression ? `, ${img.expression}` : ''}`}
              title={`#${i} ${img.pose ?? "-"} / ${img.expression ?? "-"} · ${img.width}x${img.height}`}
              style={{
                width: 116,
                height: 66,
                objectFit: "cover",
                objectPosition: "center 25%",
                borderRadius: 7,
                border: img.is_active
                  ? "1px solid rgba(var(--v2-accent-rgb), 0.35)"
                  : "1px dashed rgba(255,255,255,0.18)",
                opacity: img.is_active ? 1 : 0.35,
              }}
            />
            {expanded && (
              <button
                type="button"
                title={img.is_active ? "Remove from cycle" : "Return to cycle"}
                aria-label={`${img.is_active ? 'Remove from' : 'Return to'} thumbnail rotation: ${character.name}, image ${i + 1}`}
                disabled={busy === `img-${img.id}`}
                onClick={() => toggleImage(img)}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  border: "none",
                  borderRadius: 6,
                  padding: 2,
                  background: "rgba(0,0,0,0.6)",
                  color: img.is_active ? "#ff9c9c" : "var(--v2-accent)",
                  cursor: "pointer",
                  display: "inline-flex",
                }}
              >
                <Glyph
                  name={img.is_active ? "visibility_off" : "visibility"}
                  size={14}
                />
              </button>
            )}
            {(img.pose || img.expression) && (
              <span
                style={{
                  position: "absolute",
                  bottom: 4,
                  left: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "rgba(0,0,0,0.62)",
                  color: "#e5e2e1",
                }}
              >
                {[img.pose, img.expression].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        ))}
      </div>

      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            paddingTop: 12,
            borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.12)",
          }}
        >
          <div>
            <label htmlFor={`character-description-${character.id}`} style={labelStyle}>Physical description</label>
            <textarea
              id={`character-description-${character.id}`}
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                style={btn("primary")}
                disabled={
                  busy === "desc" || description === character.description
                }
                onClick={saveDescription}
              >
                {busy === "desc" ? "Saving…" : "Save description"}
              </button>
            </div>
          </div>

          <div style={{ maxWidth: 420 }}>
            <V2Listbox
              label="Bind to a channel (host)"
              value={addChannel}
              placeholder={
                unboundChannels.length
                  ? "Pick a channel…"
                  : "All channels bound"
              }
              options={unboundChannels.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              disabled={busy === "channels" || unboundChannels.length === 0}
              onChange={(v) => {
                setAddChannel("");
                void setChannels([...character.channel_ids, v]);
              }}
              footer={
                <span style={{ fontSize: 11, color: TEXT_2 }}>
                  Adding a channel makes this character its primary host. Existing
                  channel roles stay unchanged. Each channel can have only one
                  primary host; this character can host multiple channels.
                </span>
              }
            />
          </div>

          <div>
            <label htmlFor={`character-image-${character.id}`} style={labelStyle}>Add an image to the cycle</label>
            <input
              id={`character-image-${character.id}`}
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ fontSize: 12, color: TEXT_2 }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <p style={{ fontSize: 11, color: TEXT_2, margin: "6px 0 0 0" }}>
              {busy === "upload"
                ? "Normalising…"
                : "Uploaded photos are resized to a 1280px long edge and re-encoded as JPEG for use as reference images. Output size is controlled by the thumbnail generation settings."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
