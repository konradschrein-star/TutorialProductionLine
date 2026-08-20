"use client";

import { useState } from "react";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import {
  ReferencePicker,
  type PickedReference,
} from "@/components/thumbnails/reference-picker";
import {
  ASPECT_OPTIONS,
  RESOLUTION_OPTIONS,
  archetypeImageUrl,
  type ChannelOption,
  type ThumbnailArchetype,
} from "@/components/thumbnails/types";
import type { ActiveFormat } from "@/lib/formats";

/**
 * Archetype create/edit drawer.
 *
 * Channel is a first-class choice with "Global (all channels)" as the DEFAULT,
 * and formats are opt-in restrictions — leaving them empty means the archetype
 * works everywhere, which is what the imported library uses.
 */

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

interface Props {
  archetype: ThumbnailArchetype | null;
  channels: ChannelOption[];
  formats: ActiveFormat[];
  archetypes: ThumbnailArchetype[];
  onClose: () => void;
  onSaved: () => void;
}

export function ArchetypeEditor({
  archetype,
  channels,
  formats,
  archetypes,
  onClose,
  onSaved,
}: Props) {
  const isEdit = archetype !== null;

  const [name, setName] = useState(archetype?.name ?? "");
  const [channelId, setChannelId] = useState(archetype?.channel_id ?? "");
  const [description, setDescription] = useState(archetype?.description ?? "");
  const [layout, setLayout] = useState(archetype?.layout_instructions ?? "");
  const [basePrompt, setBasePrompt] = useState(archetype?.base_prompt ?? "");
  const [category, setCategory] = useState(archetype?.category ?? "General");
  const [featuresLogo, setFeaturesLogo] = useState(
    archetype?.features_logo ?? false,
  );
  const [selectedFormats, setSelectedFormats] = useState<string[]>(
    archetype?.formats ?? [],
  );
  const [aspect, setAspect] = useState(archetype?.aspect_ratio ?? "16:9");
  const [resolution, setResolution] = useState(archetype?.resolution ?? "1k");
  const [isActive, setIsActive] = useState(archetype?.is_active ?? true);

  const [primary, setPrimary] = useState<PickedReference[]>(
    archetype
      ? [
          {
            path: archetype.reference_image_path,
            previewUrl: archetypeImageUrl(archetype.id),
            label: archetype.name,
          },
        ]
      : [],
  );
  const [extras, setExtras] = useState<PickedReference[]>(
    (archetype?.extra_reference_paths ?? []).map((p, i) => ({
      path: p,
      previewUrl: archetypeImageUrl(archetype!.id, i + 1),
      label: `Extra ${i + 1}`,
    })),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (primary.length === 0) {
      return setError("A primary reference image is required");
    }

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        channel_id: channelId || null,
        description: description.trim() || null,
        reference_image_path: primary[0]!.path,
        extra_reference_paths: extras.map((e) => e.path),
        layout_instructions: layout.trim() || null,
        base_prompt: basePrompt.trim() || null,
        features_logo: featuresLogo,
        category: category.trim() || "General",
        formats: selectedFormats,
        aspect_ratio: aspect,
        resolution,
        is_active: isActive,
      };

      const res = await fetch(
        isEdit
          ? `/api/thumbnails/archetypes/${archetype.id}`
          : "/api/thumbnails/archetypes",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/thumbnails/archetypes/${archetype.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={isEdit ? "Edit archetype" : "New archetype"}
      subtitle={
        isEdit
          ? archetype.source_key
            ? `Imported — ${archetype.source_key}`
            : "Created in Content Forge"
          : "A reusable reference-thumbnail style"
      }
      onClose={onClose}
    >
      <Field label="Name">
        <TextInput
          value={name}
          onChange={setName}
          placeholder="e.g. Comparison #2 Really Clean"
        />
      </Field>

      <V2Listbox
        label="Channel"
        value={channelId}
        onChange={setChannelId}
        options={[
          {
            value: "",
            label: "Global — all channels",
            hint: "The default. Usable everywhere.",
          },
          ...channels.map((c) => ({
            value: c.id,
            label: c.name,
            hint: "Only this channel",
          })),
        ]}
      />

      <Field label="Description" hint="Shown on the gallery card">
        <TextArea value={description} onChange={setDescription} rows={2} />
      </Field>

      <ReferencePicker
        label="Primary reference (required)"
        value={primary}
        onChange={setPrimary}
        archetypes={archetypes}
        single
      />

      <ReferencePicker
        label="Extra references"
        value={extras}
        onChange={setExtras}
        archetypes={archetypes}
        max={4}
      />

      <Field
        label="Layout instructions"
        hint="What the model should swap out — text, character, colors, logo"
      >
        <TextArea value={layout} onChange={setLayout} rows={3} />
      </Field>

      <Field
        label="Base prompt"
        hint="Style language prepended to every generation"
      >
        <TextArea value={basePrompt} onChange={setBasePrompt} rows={3} />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <V2Listbox
          label="Aspect ratio"
          value={aspect}
          onChange={setAspect}
          options={ASPECT_OPTIONS.map((o) => ({ ...o }))}
        />
        <V2Listbox
          label="Resolution"
          value={resolution}
          onChange={setResolution}
          options={RESOLUTION_OPTIONS.map((o) => ({ ...o }))}
        />
      </div>

      <Field label="Category">
        <TextInput
          value={category}
          onChange={setCategory}
          placeholder="General"
        />
      </Field>

      <Field
        label="Format restriction"
        hint="Leave all unselected = usable by every format"
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {formats.map((f) => {
            const on = selectedFormats.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setSelectedFormats((prev) =>
                    on ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                  )
                }
                style={{
                  padding: "5px 9px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: on
                    ? "rgba(var(--v2-accent-rgb), 0.18)"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${on ? "rgba(var(--v2-accent-rgb), 0.45)" : "rgba(255,255,255,0.1)"}`,
                  color: on ? "var(--v2-accent)" : TEXT_2,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div style={{ display: "flex", gap: 16 }}>
        <Toggle
          label="Features a logo"
          checked={featuresLogo}
          onChange={setFeaturesLogo}
        />
        <Toggle label="Active" checked={isActive} onChange={setIsActive} />
      </div>

      {error && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(255,90,90,0.12)",
            border: "1px solid rgba(255,90,90,0.32)",
            color: "#ff9c9c",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <ActionButton
          text={
            saving ? "Saving…" : isEdit ? "Save changes" : "Create archetype"
          }
          icon="save"
          onClick={save}
          disabled={saving}
          primary
        />
        <ActionButton
          text="Cancel"
          icon="close"
          onClick={onClose}
          disabled={saving}
        />
        {isEdit && (
          <ActionButton
            text="Delete"
            icon="delete"
            onClick={remove}
            disabled={saving}
            danger
          />
        )}
      </div>
    </Drawer>
  );
}

// ── Shared drawer chrome ────────────────────────────────────────────────────

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          height: "100%",
          overflowY: "auto",
          background: "#16131c",
          borderLeft: "1px solid rgba(var(--v2-accent-rgb), 0.24)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: TEXT_1,
                margin: 0,
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <p style={{ fontSize: 11.5, color: TEXT_2, margin: "3px 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: TEXT_2,
              cursor: "pointer",
              padding: 2,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 22 }}
            >
              close
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
        {hint && (
          <span
            style={{
              marginLeft: 6,
              fontWeight: 500,
              textTransform: "none",
              letterSpacing: 0,
              opacity: 0.7,
            }}
          >
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
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

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        color: checked ? TEXT_1 : TEXT_2,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 34,
          height: 19,
          borderRadius: 10,
          background: checked
            ? "rgba(var(--v2-accent-rgb), 0.75)"
            : "rgba(255,255,255,0.12)",
          position: "relative",
          transition: "background 140ms",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2.5,
            left: checked ? 17 : 2.5,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 140ms",
          }}
        />
      </span>
      {label}
    </button>
  );
}

export function ActionButton({
  text,
  icon,
  onClick,
  disabled,
  primary,
  danger,
}: {
  text: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const bg = danger
    ? "rgba(255,90,90,0.14)"
    : primary
      ? "rgba(var(--v2-accent-rgb), 0.18)"
      : "rgba(255,255,255,0.05)";
  const border = danger
    ? "rgba(255,90,90,0.4)"
    : primary
      ? "rgba(var(--v2-accent-rgb), 0.45)"
      : "rgba(255,255,255,0.12)";
  const color = danger ? "#ff9c9c" : primary ? "var(--v2-accent)" : TEXT_2;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 14px",
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
        {icon}
      </span>
      {text}
    </button>
  );
}
