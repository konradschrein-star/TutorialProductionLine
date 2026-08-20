"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchetypeGallery } from "./archetype-gallery";
import { ArchetypeEditor } from "./archetype-editor";
import { GeneratePanel } from "./generate-panel";
import { LibraryPanel } from "./library-panel";
import { BrandingForm, type ChannelBrandingData } from "./branding-form";
import type { ThumbnailArchetype } from "@repo/db";
import type { ActiveFormat } from "@/lib/formats";
import type { ChannelOption } from "@/components/thumbnails/types";

/**
 * Thumbnail Studio — the global thumbnail system.
 *
 * Ported from the standalone "Thumbnail Creator V2" tool
 * (konradschrein-star/thumbnail-tool) and reskinned to V2. Archetypes are
 * global by default; generation runs through the media gateway; every
 * generated thumbnail is reusable as a reference for the next one.
 */

const TABS = [
  { id: "archetypes", label: "Archetypes", icon: "grid_view" },
  { id: "generate", label: "Generate", icon: "auto_awesome" },
  { id: "library", label: "Library", icon: "photo_library" },
  { id: "branding", label: "Channel Branding", icon: "palette" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TEXT_1 = "#e5e2e1";
const TEXT_2 = "#cdc3d7";

interface Props {
  archetypes: ThumbnailArchetype[];
  channels: ChannelOption[];
  formats: ActiveFormat[];
  channelData: Record<string, ChannelBrandingData>;
}

export function ThumbnailStudioClient({
  archetypes,
  channels,
  formats,
  channelData,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("archetypes");
  const [editing, setEditing] = useState<ThumbnailArchetype | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [generateWith, setGenerateWith] = useState<string | null>(null);

  const globalCount = archetypes.filter((a) => a.channel_id === null).length;

  function openEditor(a: ThumbnailArchetype | null) {
    setEditing(a);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 0 48px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: TEXT_1,
              margin: 0,
              marginBottom: 5,
            }}
          >
            Thumbnail Studio
          </h1>
          <p style={{ fontSize: 12.5, color: TEXT_2, margin: 0 }}>
            Global thumbnail engine — reference-driven archetypes, every format
            and channel. Defaults to 16:9 at 1K.
          </p>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Stat value={archetypes.length} label="Archetypes" />
          <Stat value={globalCount} label="Global" accent />
          <Stat value={channels.length} label="Channels" />
          {/* The cross-assistant report. A link rather than a tab because the
              page is ADMIN/MANAGER-only while this Studio is open to anyone
              with view:settings — a tab would render for people the page then
              redirects away from. */}
          <a
            href="/thumbnails/overview"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb), 0.28)",
              color: "var(--v2-accent)",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              insights
            </span>
            Overview
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 18,
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.14)",
          paddingBottom: 2,
          flexWrap: "wrap",
        }}
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 14px",
                border: "none",
                borderBottom: `2px solid ${on ? "var(--v2-accent)" : "transparent"}`,
                background: on
                  ? "rgba(var(--v2-accent-rgb), 0.09)"
                  : "transparent",
                color: on ? "var(--v2-accent)" : TEXT_2,
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                borderRadius: "6px 6px 0 0",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                {t.icon}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "archetypes" && (
        <ArchetypeGallery
          archetypes={archetypes}
          channels={channels}
          onEdit={openEditor}
          onCreate={() => openEditor(null)}
          onGenerateWith={(a) => {
            setGenerateWith(a.id);
            setTab("generate");
          }}
          onChanged={() => router.refresh()}
        />
      )}

      {tab === "generate" && (
        <GeneratePanel
          archetypes={archetypes}
          channels={channels}
          formats={formats}
          initialArchetypeId={generateWith}
        />
      )}

      {tab === "library" && (
        <LibraryPanel channels={channels} archetypes={archetypes} />
      )}

      {tab === "branding" && (
        <BrandingForm
          channels={channels}
          archetypes={archetypes}
          channelData={channelData}
        />
      )}

      {editorOpen && (
        <ArchetypeEditor
          archetype={editing}
          channels={channels}
          formats={formats}
          archetypes={archetypes}
          onClose={closeEditor}
          onSaved={() => {
            closeEditor();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: accent ? "var(--v2-accent)" : TEXT_1,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: TEXT_2,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}
