"use client";

import { useState, useEffect } from "react";
import { registerWorkspaceNavigationGuard } from "@/lib/workspace-navigation-guard";
import { useRouter } from "next/navigation";
import { ArchetypeGallery } from "./archetype-gallery";
import { ArchetypeEditor } from "./archetype-editor";
import { GeneratePanel } from "./generate-panel";
import { LibraryPanel } from "./library-panel";
import { BrandingForm, type ChannelBrandingData } from "./branding-form";
import { Composer } from "./composer";
import { ThumbnailBatchGrid } from "../../tutorial-studio/_components/thumbnail-batch-grid";
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
  { id: "videos", label: "Language matrix", icon: "view_week" },
  { id: "composer", label: "Thumbnail editor", icon: "dashboard_customize" },
  { id: "archetypes", label: "Archetypes", icon: "grid_view" },
  { id: "generate", label: "Generate", icon: "auto_awesome" },
  { id: "library", label: "Library", icon: "photo_library" },
  { id: "branding", label: "Channel Branding", icon: "palette" },
] as const;

// Tabs that depend on the AI/media-gateway infra (image-provider keys, worker).
// The Composer is the primary offline tool; these are the optional AI flow.
const AI_TABS: readonly TabId[] = ["generate"];

export type ThumbnailStudioTabId = (typeof TABS)[number]["id"];
type TabId = ThumbnailStudioTabId;

const TEXT_1 = "var(--v2-text-1)";
const TEXT_2 = "var(--v2-text-2)";

interface Props {
  archetypes: ThumbnailArchetype[];
  channels: ChannelOption[];
  formats: ActiveFormat[];
  channelData: Record<string, ChannelBrandingData>;
  initialJobId: string | null;
  initialTab: ThumbnailStudioTabId;
  canConfigure: boolean;
}

export function ThumbnailStudioClient({
  archetypes,
  channels,
  formats,
  channelData,
  initialJobId,
  initialTab,
  canConfigure,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(initialJobId ? "composer" : initialTab);
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [editing, setEditing] = useState<ThumbnailArchetype | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [generateWith, setGenerateWith] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  function leaveEditor() { return !hasUnsavedChanges || window.confirm("Leave this thumbnail draft? Unsaved edits will be lost. Use Save draft first to keep them without approving."); }
  useEffect(() => registerWorkspaceNavigationGuard(() => !hasUnsavedChanges || window.confirm("Leave this thumbnail draft? Unsaved edits will be lost. Use Save draft first to keep them without approving.")), [hasUnsavedChanges]);

  const globalCount = archetypes.filter((a) => a.channel_id === null).length;
  const visibleTabs = TABS.filter(
    (item) => canConfigure || item.id === "videos" || item.id === "composer",
  );

  function openEditor(a: ThumbnailArchetype | null) {
    setEditing(a);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  return (
    <div style={{ width: "100%", minWidth: 0, margin: "0 auto", padding: "12px 0 48px" }}>
      {/* Header */}
      <div
        style={{
          display: tab === "composer" && activeJobId ? "none" : "flex",
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
          <p style={{ fontSize: 14, color: TEXT_2, margin: 0, lineHeight: 1.5 }}>
            Compare languages. Edit together or individually. Approve one tutorial at a time.
          </p>
        </div>
        {canConfigure && <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
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
        </div>}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: tab === "composer" && activeJobId ? 8 : 18,
          borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.14)",
          paddingBottom: 2,
          flexWrap: "wrap",
        }}
      >
        {visibleTabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (t.id !== tab && tab === "composer" && !leaveEditor()) return;
                setTab(t.id);
                if (t.id === "videos" && activeJobId) {
                  setActiveJobId(null);
                  router.replace("/thumbnails", { scroll: false });
                } else if (!activeJobId) {
                  router.replace(`/thumbnails?tab=${t.id}`, { scroll: false });
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "12px 16px",
                minHeight: 44,
                border: "none",
                borderBottom: `2px solid ${on ? "var(--v2-accent)" : "transparent"}`,
                background: on
                  ? "rgba(var(--v2-accent-rgb), 0.09)"
                  : "transparent",
                color: on ? "var(--v2-accent)" : TEXT_2,
                fontSize: 14,
                fontWeight: 600,
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

      {tab === "composer" && (activeJobId ? (
        <Composer jobId={activeJobId} onDirtyChange={setHasUnsavedChanges} onBack={() => { if (!leaveEditor()) return; setHasUnsavedChanges(false); setTab("videos"); setActiveJobId(null); router.replace("/thumbnails", { scroll: false }); }} />
      ) : (
        <div style={{ padding: 36, border: "1px solid var(--v2-border-2)", borderRadius: 10, textAlign: "center", color: TEXT_2 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT_1 }}>Choose a video before composing</div>
          <div style={{ marginTop: 7, fontSize: 14 }}>Open a recorded tutorial from the language matrix. Localized videos do not need to be finished first.</div>
          <button type="button" className="v2-btn" onClick={() => { setTab("videos"); router.replace("/thumbnails?tab=videos", { scroll: false }); }} style={{ marginTop: 16 }}>Choose tutorial</button>
        </div>
      ))}
      {tab === "videos" && <ThumbnailBatchGrid />}

      {/* AI generation depends on media-gateway infra that is not always
          present. The Composer above is the primary, fully-offline tool; the
          tabs below are the optional AI flow. */}
      {AI_TABS.includes(tab) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            marginBottom: 14,
            borderRadius: 8,
            background: "var(--v2-surface-2)",
            border: "1px solid var(--v2-border-2)",
            color: TEXT_2,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            info
          </span>
          AI generation is optional and requires image-provider keys. For a
          fully-offline workflow use the <strong>Composer</strong> tab.
        </div>
      )}

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
