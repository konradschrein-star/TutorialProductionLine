"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "../_components/glass-card";
import { PresetPreview } from "@/components/subtitles/PresetPreview";
import {
  SubtitleFontFaceStyles,
  useSubtitleFonts,
} from "@/components/subtitles/font-faces";
import { Segmented } from "@/components/subtitles/primitives";
import Link from "next/link";
import { defaultSubtitleStyle } from "@repo/db/subtitles";

type Preset = {
  id: string;
  name: string;
  description: string | null;
  engine: "remotion" | "ffmpeg";
  is_built_in: boolean;
  is_locked: boolean;
  is_active: boolean;
  sort_order: number | null;
  tags: string[];
  config: Record<string, unknown>;
};

type Assignment = {
  id: string;
  preset_id: string;
  format: string | null;
  channel_id: string | null;
  is_active: boolean;
  preset_name: string | null;
  preset_engine: string | null;
};

type Channel = { id: string; name: string };

// A freshly-created preset starts from the canonical default style. This used
// to be two hand-maintained inline copies (one per engine) that drifted from
// the real defaults; both engines now share one config, and it is imported from
// the schema subpath that this file's preview already pulls in.
const NEW_REMOTION_CONFIG = defaultSubtitleStyle;
const NEW_FFMPEG_CONFIG = defaultSubtitleStyle;

function sortPresets(a: Preset, b: Preset): number {
  const ao = a.sort_order ?? 9999;
  const bo = b.sort_order ?? 9999;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}

export default function SubtitlesPage() {
  const router = useRouter();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [previewAspect, setPreviewAspect] = useState<"16:9" | "9:16">(() => {
    if (typeof window === "undefined") return "16:9";
    const saved = window.localStorage.getItem("cf.subtitles.previewAspect");
    return saved === "9:16" ? "9:16" : "16:9";
  });
  const setPreviewAspectPersist = (a: "16:9" | "9:16") => {
    setPreviewAspect(a);
    if (typeof window !== "undefined")
      window.localStorage.setItem("cf.subtitles.previewAspect", a);
  };
  // Registers an @font-face for every uploaded/built-in subtitle font, so each
  // card previews in the typeface its preset actually asks for. Without this
  // every preset falls back to the system font and they all look alike.
  const fontsState = useSubtitleFonts();

  async function reload() {
    const presetsP = fetch("/api/v1/subtitle-presets")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    // Assignments API (8b) may not exist yet — degrade gracefully.
    const assignP = fetch("/api/v1/subtitle-assignments")
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .catch(() => ({ assignments: [] }));
    const channelsP = fetch("/api/v1/channels")
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .catch(() => ({ channels: [] }));
    const [p, a, ch] = await Promise.all([presetsP, assignP, channelsP]);
    setPresets(Array.isArray(p) ? p : []);
    setAssignments(Array.isArray(a?.assignments) ? a.assignments : []);
    setChannels(Array.isArray(ch?.channels) ? ch.channels : []);
  }

  useEffect(() => {
    reload();
  }, []);

  const channelName = useMemo(() => {
    const m = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "channel") : "");
  }, [channels]);

  const assignmentsByPreset = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.is_active === false) continue;
      const list = m.get(a.preset_id) ?? [];
      list.push(a);
      m.set(a.preset_id, list);
    }
    return m;
  }, [assignments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return presets
      .filter((p) => p.is_active !== false)
      .filter((p) => {
        if (!q) return true;
        const assigned = assignmentsByPreset.get(p.id) ?? [];
        const assignedText = assigned
          .map((a) => `${a.format ?? "global"} ${channelName(a.channel_id)}`)
          .join(" ");
        const hay = [
          p.name,
          p.description ?? "",
          (p.tags ?? []).join(" "),
          p.engine,
          assignedText,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
  }, [presets, query, assignmentsByPreset, channelName]);

  const groups: Array<{ engine: "remotion" | "ffmpeg"; label: string }> = [
    { engine: "remotion", label: "Remotion (Rich)" },
    { engine: "ffmpeg", label: "FFmpeg (ASS)" },
  ];

  async function createPreset(engine: "remotion" | "ffmpeg") {
    setCreating(true);
    setShowNewMenu(false);
    try {
      const res = await fetch("/api/v1/subtitle-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            engine === "remotion" ? "New Remotion Preset" : "New ASS Preset",
          engine,
          config:
            engine === "remotion" ? NEW_REMOTION_CONFIG : NEW_FFMPEG_CONFIG,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Create failed: ${err.error ?? res.statusText}`);
        return;
      }
      const created = await res.json();
      router.push(`/subtitles/${created.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function duplicatePreset(p: Preset) {
    const res = await fetch("/api/v1/subtitle-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${p.name} (copy)`,
        description: p.description ?? undefined,
        engine: p.engine,
        config: p.config,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/subtitles/${created.id}`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Duplicate failed: ${err.error ?? res.statusText}`);
    }
  }

  async function toggleLock(p: Preset) {
    const res = await fetch(`/api/v1/subtitle-presets/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: !p.is_locked }),
    });
    if (res.ok) {
      reload();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not change lock: ${err.error ?? res.statusText}`);
    }
  }

  async function deletePreset(p: Preset) {
    if (!confirm(`Delete preset "${p.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/v1/subtitle-presets/${p.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      reload();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Delete failed: ${err.error ?? res.statusText}`);
    }
  }

  const iconBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 6,
    border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
    background: "rgba(255,255,255,0.03)",
    color: "#cdc3d7",
    cursor: "pointer",
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <SubtitleFontFaceStyles fonts={fontsState.fonts} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          gap: 12,
        }}
      >
        <h1
          style={{ fontSize: 24, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Subtitle Presets
        </h1>
        <div style={{ display: "flex", gap: 12, position: "relative" }}>
          <Link href="/subtitles/assignments">
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
                grid_view
              </span>
              Assignments
            </button>
          </Link>
          <Link href="/subtitles/fonts">
            <button
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                background: "transparent",
                color: "#cdc3d7",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Manage Fonts
            </button>
          </Link>
          <button
            disabled={creating}
            onClick={() => setShowNewMenu((v) => !v)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--v2-accent)",
              color: "#fff",
              cursor: creating ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: creating ? 0.7 : 1,
            }}
          >
            {creating ? "Creating..." : "New Preset"}
          </button>
          {showNewMenu && (
            <div
              style={{
                position: "absolute",
                top: 44,
                right: 0,
                zIndex: 20,
                background: "#1a1820",
                border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
                borderRadius: 8,
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 200,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <button
                onClick={() => createPreset("remotion")}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "#e5e2e1",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Remotion (Rich)
              </button>
              <button
                onClick={() => createPreset("ffmpeg")}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "#e5e2e1",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                FFmpeg (ASS)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search + preview aspect */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 260 }}>
          <span
            className="material-symbols-outlined"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 18,
              color: "#cdc3d7",
            }}
          >
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, tag, assigned format or channel…"
            style={{
              width: "100%",
              padding: "10px 12px 10px 40px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              background: "rgba(255,255,255,0.03)",
              color: "#e5e2e1",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ width: 180 }}>
          <Segmented
            options={[
              { value: "16:9" as const, label: "16:9" },
              { value: "9:16" as const, label: "9:16" },
            ]}
            value={previewAspect}
            onChange={setPreviewAspectPersist}
          />
        </div>
      </div>

      {fontsState.status === "error" && (
        <GlassCard
          style={{
            padding: 12,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid rgba(255,138,138,0.35)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color: "#ff8a8a" }}
          >
            font_download_off
          </span>
          <span style={{ fontSize: 12, color: "#ff8a8a" }}>
            Font registry could not be loaded ({fontsState.error}). Previews
            below are rendering in a fallback typeface, NOT the preset&apos;s
            real font.
          </span>
        </GlassCard>
      )}

      {groups.map((group) => {
        const items = filtered
          .filter((p) => p.engine === group.engine)
          .sort(sortPresets);
        if (items.length === 0) return null;
        return (
          <div key={group.engine} style={{ marginBottom: 32 }}>
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
              {group.label} · {items.length}
            </h2>
            <div
              style={{
                display: "grid",
                // Narrower min at 9:16 so ~4 portrait cards fit per row instead
                // of 2 towering ones.
                gridTemplateColumns:
                  previewAspect === "9:16"
                    ? "repeat(auto-fill, minmax(220px, 1fr))"
                    : "repeat(auto-fill, minmax(300px, 1fr))",
                gap: 16,
              }}
            >
              {items.map((preset) => {
                const assigned = assignmentsByPreset.get(preset.id) ?? [];
                return (
                  <GlassCard
                    key={preset.id}
                    style={{
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <h3
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: "#e5e2e1",
                          margin: 0,
                        }}
                      >
                        {preset.name}
                      </h3>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {preset.is_locked && (
                          <span
                            title="Locked — unlock or clone to customize"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 2,
                              fontSize: 10,
                              background: "rgba(255,196,120,0.14)",
                              color: "#ffc478",
                              padding: "2px 7px",
                              borderRadius: 20,
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 12 }}
                            >
                              lock
                            </span>
                            LOCKED
                          </span>
                        )}
                        {preset.is_built_in && (
                          <span
                            style={{
                              fontSize: 10,
                              background: "rgba(var(--v2-accent-rgb),0.2)",
                              color: "var(--v2-accent)",
                              padding: "2px 8px",
                              borderRadius: 20,
                            }}
                          >
                            BUILT-IN
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 10,
                            background: "rgba(255,255,255,0.06)",
                            color: "#cdc3d7",
                            padding: "2px 8px",
                            borderRadius: 20,
                          }}
                        >
                          {preset.engine}
                        </span>
                      </div>
                    </div>

                    {preset.is_locked && preset.is_built_in && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          color: "#ffc478",
                          marginTop: -2,
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 13 }}
                        >
                          lock
                        </span>
                        Built-in — clone it to customize, or unlock to edit in
                        place.
                      </div>
                    )}

                    <PresetPreview
                      engine={preset.engine}
                      config={preset.config}
                      aspect={previewAspect}
                      seed={preset.id}
                    />

                    {preset.description && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "#cdc3d7",
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {preset.description}
                      </p>
                    )}

                    {(preset.tags ?? []).length > 0 && (
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                      >
                        {preset.tags.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: 10,
                              color: "rgba(var(--v2-accent-rgb),0.85)",
                              background: "rgba(var(--v2-accent-rgb),0.08)",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "auto",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: assigned.length ? "#8de0a0" : "#8a8290",
                        }}
                        title={assigned
                          .map(
                            (a) =>
                              `${a.format ?? "global"}${
                                a.channel_id
                                  ? ` / ${channelName(a.channel_id)}`
                                  : ""
                              }`,
                          )
                          .join(", ")}
                      >
                        {assigned.length
                          ? `Assigned to ${assigned.length}`
                          : "Unassigned"}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          title="Edit"
                          onClick={() => router.push(`/subtitles/${preset.id}`)}
                          style={iconBtn}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 17 }}
                          >
                            edit
                          </span>
                        </button>
                        <button
                          title={
                            preset.is_locked
                              ? "Unlock — allow editing in place"
                              : "Lock — require a clone to change it"
                          }
                          onClick={() => toggleLock(preset)}
                          style={
                            preset.is_locked
                              ? {
                                  ...iconBtn,
                                  color: "#ffc478",
                                  borderColor: "rgba(255,196,120,0.35)",
                                }
                              : iconBtn
                          }
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 17 }}
                          >
                            {preset.is_locked ? "lock" : "lock_open"}
                          </span>
                        </button>
                        <button
                          title="Duplicate"
                          onClick={() => duplicatePreset(preset)}
                          style={iconBtn}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 17 }}
                          >
                            content_copy
                          </span>
                        </button>
                        {!preset.is_built_in && (
                          <button
                            title="Delete"
                            onClick={() => deletePreset(preset)}
                            style={{
                              ...iconBtn,
                              color: "#e08d8d",
                              borderColor: "rgba(224,141,141,0.3)",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 17 }}
                            >
                              delete
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <GlassCard style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "#cdc3d7", margin: 0 }}>
            {presets.length === 0
              ? "No presets yet. Create one or run seed:subtitle-presets."
              : "No presets match your search."}
          </p>
        </GlassCard>
      )}
    </div>
  );
}
