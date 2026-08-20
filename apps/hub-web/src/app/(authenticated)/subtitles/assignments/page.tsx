"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GlassCard } from "../../_components/glass-card";

type Preset = {
  id: string;
  name: string;
  engine: "remotion" | "ffmpeg";
  is_active: boolean;
};

type Assignment = {
  id: string;
  preset_id: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  preset_name: string | null;
  preset_engine: string | null;
  preset_is_active: boolean | null;
};

type Channel = { id: string; name: string };

function prettyFormat(f: string): string {
  return f
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A preset <select> with an explicit "None (captions off)" option. */
function PresetSelect({
  presets,
  value,
  onChange,
  disabled,
}: {
  presets: Preset[];
  value: string;
  onChange: (presetId: string) => void;
  disabled?: boolean;
}) {
  const remotion = presets.filter((p) => p.engine === "remotion");
  const ffmpeg = presets.filter((p) => p.engine === "ffmpeg");
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
        background: "rgba(255,255,255,0.03)",
        color: "#e5e2e1",
        fontSize: 13,
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <option value="" style={{ background: "#1a1820" }}>
        — None (captions off) —
      </option>
      {remotion.length > 0 && (
        <optgroup label="Remotion (Rich)" style={{ background: "#1a1820" }}>
          {remotion.map((p) => (
            <option key={p.id} value={p.id} style={{ background: "#1a1820" }}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {ffmpeg.length > 0 && (
        <optgroup label="FFmpeg (ASS)" style={{ background: "#1a1820" }}>
          {ffmpeg.map((p) => (
            <option key={p.id} value={p.id} style={{ background: "#1a1820" }}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function SubtitleAssignmentsPage() {
  const [formats, setFormats] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  // "Add override" draft state
  const [draftFormat, setDraftFormat] = useState("");
  const [draftChannel, setDraftChannel] = useState("");
  const [draftPreset, setDraftPreset] = useState("");

  async function reload() {
    const [a, p, ch] = await Promise.all([
      fetch("/api/v1/subtitle-assignments")
        .then((r) => (r.ok ? r.json() : { assignments: [], formats: [] }))
        .catch(() => ({ assignments: [], formats: [] })),
      fetch("/api/v1/subtitle-presets")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/v1/channels")
        .then((r) => (r.ok ? r.json() : { channels: [] }))
        .catch(() => ({ channels: [] })),
    ]);
    setAssignments(Array.isArray(a?.assignments) ? a.assignments : []);
    setFormats(Array.isArray(a?.formats) ? a.formats : []);
    setPresets(
      Array.isArray(p) ? p.filter((x: Preset) => x.is_active !== false) : [],
    );
    setChannels(Array.isArray(ch?.channels) ? ch.channels : []);
  }

  useEffect(() => {
    reload();
  }, []);

  const channelName = useMemo(() => {
    const m = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "Unknown channel") : "");
  }, [channels]);

  const activeAssignments = useMemo(
    () => assignments.filter((a) => a.is_active !== false),
    [assignments],
  );

  function findAssignment(
    format: string | null,
    channelId: string | null,
  ): Assignment | undefined {
    return activeAssignments.find(
      (a) => a.format === format && a.channel_id === channelId,
    );
  }

  const overrides = useMemo(
    () =>
      activeAssignments.filter(
        (a) => a.format !== null && a.channel_id !== null,
      ),
    [activeAssignments],
  );

  async function save(
    key: string,
    format: string | null,
    channelId: string | null,
    presetId: string,
  ) {
    setSaving(key);
    try {
      const res = await fetch("/api/v1/subtitle-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          channel_id: channelId,
          preset_id: presetId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Save failed: ${err.error ?? res.statusText}`);
      }
      await reload();
    } finally {
      setSaving(null);
    }
  }

  const globalAssignment = findAssignment(null, null);
  // A global default whose preset was soft-deleted no longer resolves — treat
  // it as absent when deciding whether a format is covered by the global.
  const globalActive =
    !!globalAssignment && globalAssignment.preset_is_active !== false;

  const cellStyle: React.CSSProperties = {
    padding: "12px 14px",
    verticalAlign: "middle",
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 12,
        }}
      >
        <h1
          style={{ fontSize: 24, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Subtitle Assignments
        </h1>
        <Link href="/subtitles">
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
              background: "transparent",
              color: "#cdc3d7",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              arrow_back
            </span>
            Back to Library
          </button>
        </Link>
      </div>
      <p
        style={{
          fontSize: 13,
          color: "#cdc3d7",
          margin: "0 0 24px",
          lineHeight: 1.5,
        }}
      >
        Assign a preset to each format to turn captions on. A format with no
        preset renders{" "}
        <strong style={{ color: "#e08d8d" }}>without captions</strong>.
        Per-channel overrides take priority over the format-level assignment.
      </p>

      {/* Global default */}
      <GlassCard style={{ padding: 16, marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e5e2e1" }}>
              Global default
            </div>
            <div style={{ fontSize: 12, color: "#8a8290", marginTop: 2 }}>
              Fallback for any format without its own assignment.
            </div>
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <PresetSelect
              presets={presets}
              value={globalAssignment?.preset_id ?? ""}
              disabled={saving === "global"}
              onChange={(pid) => save("global", null, null, pid)}
            />
          </div>
        </div>
      </GlassCard>

      {/* Format-level matrix */}
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#cdc3d7",
          margin: "0 0 12px",
        }}
      >
        Formats
      </h2>
      <GlassCard style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                borderBottom: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              }}
            >
              <th
                style={{
                  ...cellStyle,
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "#8a8290",
                }}
              >
                Format
              </th>
              <th
                style={{
                  ...cellStyle,
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "#8a8290",
                  width: "45%",
                }}
              >
                Preset
              </th>
              <th
                style={{
                  ...cellStyle,
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "#8a8290",
                  width: 120,
                }}
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {formats.map((fmt) => {
              const assigned = findAssignment(fmt, null);
              return (
                <tr
                  key={fmt}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <td style={{ ...cellStyle, color: "#e5e2e1", fontSize: 14 }}>
                    {prettyFormat(fmt)}
                  </td>
                  <td style={cellStyle}>
                    <PresetSelect
                      presets={presets}
                      value={assigned?.preset_id ?? ""}
                      disabled={saving === fmt}
                      onChange={(pid) => save(fmt, fmt, null, pid)}
                    />
                  </td>
                  <td style={cellStyle}>
                    {assigned && assigned.preset_is_active === false ? (
                      <span
                        style={{ fontSize: 12, color: "#e0b45a" }}
                        title="Assigned preset was deleted — captions will NOT render. Pick another."
                      >
                        ⚠ Stale (captions off)
                      </span>
                    ) : assigned ? (
                      <span style={{ fontSize: 12, color: "#8de0a0" }}>
                        ● On
                      </span>
                    ) : globalActive ? (
                      <span
                        style={{ fontSize: 12, color: "#cdc3d7" }}
                        title="Uses the global default"
                      >
                        ● Global
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "#e08d8d" }}>
                        ○ Off
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {formats.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...cellStyle, color: "#8a8290" }}>
                  No active formats.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>

      {/* Per-channel overrides */}
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#cdc3d7",
          margin: "0 0 12px",
        }}
      >
        Per-channel overrides
      </h2>
      <GlassCard
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {overrides.length === 0 && (
          <p style={{ fontSize: 13, color: "#8a8290", margin: 0 }}>
            No per-channel overrides. Add one below to override a format&apos;s
            preset for a specific channel.
          </p>
        )}
        {overrides.map((o) => (
          <div
            key={o.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              paddingBottom: 12,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ flex: "1 1 160px", fontSize: 13, color: "#e5e2e1" }}>
              {prettyFormat(o.format!)}
              <span style={{ color: "#8a8290" }}> · </span>
              <span style={{ color: "#cdc3d7" }}>
                {channelName(o.channel_id)}
              </span>
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <PresetSelect
                presets={presets}
                value={o.preset_id}
                disabled={saving === o.id}
                onChange={(pid) => save(o.id, o.format, o.channel_id, pid)}
              />
            </div>
            <button
              title="Remove override"
              onClick={() => save(o.id, o.format, o.channel_id, "")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 6,
                border: "1px solid rgba(224,141,141,0.3)",
                background: "rgba(255,255,255,0.03)",
                color: "#e08d8d",
                cursor: "pointer",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 17 }}
              >
                delete
              </span>
            </button>
          </div>
        ))}

        {/* Add override */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          <div style={{ flex: "1 1 160px" }}>
            <label
              style={{
                fontSize: 11,
                color: "#8a8290",
                display: "block",
                marginBottom: 4,
              }}
            >
              Format
            </label>
            <select
              value={draftFormat}
              onChange={(e) => setDraftFormat(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                background: "rgba(255,255,255,0.03)",
                color: "#e5e2e1",
                fontSize: 13,
              }}
            >
              <option value="" style={{ background: "#1a1820" }}>
                Select…
              </option>
              {formats.map((f) => (
                <option key={f} value={f} style={{ background: "#1a1820" }}>
                  {prettyFormat(f)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label
              style={{
                fontSize: 11,
                color: "#8a8290",
                display: "block",
                marginBottom: 4,
              }}
            >
              Channel
            </label>
            <select
              value={draftChannel}
              onChange={(e) => setDraftChannel(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                background: "rgba(255,255,255,0.03)",
                color: "#e5e2e1",
                fontSize: 13,
              }}
            >
              <option value="" style={{ background: "#1a1820" }}>
                Select…
              </option>
              {channels.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  style={{ background: "#1a1820" }}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label
              style={{
                fontSize: 11,
                color: "#8a8290",
                display: "block",
                marginBottom: 4,
              }}
            >
              Preset
            </label>
            <PresetSelect
              presets={presets}
              value={draftPreset}
              onChange={setDraftPreset}
            />
          </div>
          <button
            disabled={
              !draftFormat ||
              !draftChannel ||
              !draftPreset ||
              saving === "draft"
            }
            onClick={async () => {
              await save("draft", draftFormat, draftChannel, draftPreset);
              setDraftFormat("");
              setDraftChannel("");
              setDraftPreset("");
            }}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--v2-accent)",
              color: "#fff",
              cursor:
                !draftFormat || !draftChannel || !draftPreset
                  ? "not-allowed"
                  : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: !draftFormat || !draftChannel || !draftPreset ? 0.5 : 1,
            }}
          >
            Add override
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
