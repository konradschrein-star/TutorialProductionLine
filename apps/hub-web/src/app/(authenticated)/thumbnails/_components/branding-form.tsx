"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/app/(authenticated)/_components/glass-card";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import Link from "next/link";
import {
  saveChannelBranding,
  saveChannelArchetypes,
} from "@/app/actions/thumbnails";
import type {
  ThumbnailArchetype,
  ChannelPersona,
  ChannelThumbnailProfile,
} from "@repo/db";

export interface ChannelBrandingData {
  persona: ChannelPersona | null;
  profile: ChannelThumbnailProfile | null;
  archetypeIds: string[];
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  color: "#e5e2e1",
  background: "rgba(255,255,255, 0.05)",
  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
  borderRadius: 6,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#e5e2e1",
  marginBottom: 8,
};

async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/thumbnails/upload", {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Upload failed");
  }
  const json = (await res.json()) as { path: string };
  return json.path;
}

interface Props {
  channels: Array<{ id: string; name: string }>;
  archetypes: ThumbnailArchetype[];
  channelData: Record<string, ChannelBrandingData>;
}

export function BrandingForm({ channels, archetypes, channelData }: Props) {
  const router = useRouter();
  const [channelId, setChannelId] = useState<string>(channels[0]?.id ?? "");

  /**
   * The channel's host, READ ONLY. `channel_personas` is a view over the
   * character library (migration 0061); the editable form that used to live
   * here wrote a second, divergable copy of the same concept and claimed it was
   * "reusable for intros & mascots", which nothing ever consumed.
   */
  const persona = channelData[channelId]?.persona ?? null;

  // Branding sub-form state
  const [logoPath, setLogoPath] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [promptMode, setPromptMode] = useState<"programmatic" | "deepseek">(
    "programmatic",
  );
  const [extraNotes, setExtraNotes] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);

  // Archetype links state
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [linksSaving, setLinksSaving] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);

  useEffect(() => {
    const data = channelData[channelId];
    setLogoPath(data?.profile?.logo_image_path ?? "");
    setPrimaryColor(data?.profile?.primary_color ?? "");
    setSecondaryColor(data?.profile?.secondary_color ?? "");
    setPromptMode(
      (data?.profile?.default_prompt_mode as "programmatic" | "deepseek") ??
        "programmatic",
    );
    setExtraNotes(data?.profile?.extra_prompt_notes ?? "");
    setBrandingError(null);

    setLinkedIds(data?.archetypeIds ?? []);
    setLinksError(null);
  }, [channelId, channelData]);

  const handleLogoImage = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLogoUploading(true);
      setBrandingError(null);
      try {
        setLogoPath(await uploadFile(file));
      } catch (err) {
        setBrandingError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setLogoUploading(false);
      }
    },
    [],
  );

  const handleSaveBranding = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!channelId) return;
      setBrandingSaving(true);
      setBrandingError(null);
      try {
        const result = await saveChannelBranding({
          channel_id: channelId,
          logo_image_path: logoPath || undefined,
          primary_color: primaryColor.trim() || undefined,
          secondary_color: secondaryColor.trim() || undefined,
          default_prompt_mode: promptMode,
          extra_prompt_notes: extraNotes.trim() || undefined,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to save branding");
        }
        router.refresh();
      } catch (err) {
        setBrandingError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setBrandingSaving(false);
      }
    },
    [
      channelId,
      logoPath,
      primaryColor,
      secondaryColor,
      promptMode,
      extraNotes,
      router,
    ],
  );

  const toggleLink = useCallback((id: string) => {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleSaveLinks = useCallback(async () => {
    if (!channelId) return;
    setLinksSaving(true);
    setLinksError(null);
    try {
      const result = await saveChannelArchetypes(channelId, linkedIds);
      if (!result.success) {
        throw new Error(result.error ?? "Failed to save archetype links");
      }
      router.refresh();
    } catch (err) {
      setLinksError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLinksSaving(false);
    }
  }, [channelId, linkedIds, router]);

  if (channels.length === 0) {
    return (
      <GlassCard style={{ padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          No channels found. Create a channel first.
        </p>
      </GlassCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ maxWidth: 360 }}>
        <V2Listbox
          label="Channel"
          value={channelId}
          onChange={setChannelId}
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>

      {/* Channel host — READ ONLY. Editing moved to the Character Library. */}
      <GlassCard
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Channel Host
          </h3>
          <p style={{ fontSize: 11, color: "#cdc3d7", margin: "4px 0 0" }}>
            Read-only. A channel&apos;s host is a CHARACTER — a name, a
            description and many photos — and it is managed in the Character
            Library, not here. This panel just shows what this channel currently
            resolves to.
          </p>
        </div>

        {persona ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: 12,
              borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}>
                {persona.name}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "#cdc3d7",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {persona.description}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#ffb27a" }}>
            No host character bound to this channel. Thumbnails for it will
            invent a different face every time until one is bound.
          </div>
        )}

        <div>
          <Link
            href="/characters"
            style={{
              display: "inline-block",
              padding: "9px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--v2-accent)",
              background: "rgba(var(--v2-accent-rgb), 0.14)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.4)",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Open the Character Library
          </Link>
        </div>
      </GlassCard>

      {/* Thumbnail Branding */}
      <form onSubmit={handleSaveBranding}>
        <GlassCard
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Thumbnail Branding
          </h3>

          <div>
            <label htmlFor="branding-logo" style={labelStyle}>
              Logo
            </label>
            <input
              id="branding-logo"
              type="file"
              accept="image/*"
              onChange={handleLogoImage}
              style={{ ...inputStyle, padding: "8px 12px" }}
            />
            {logoUploading && (
              <p style={{ fontSize: 11, color: "#cdc3d7", margin: "6px 0 0" }}>
                Uploading...
              </p>
            )}
            {logoPath && !logoUploading && (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--v2-accent)",
                  margin: "6px 0 0",
                  wordBreak: "break-all",
                }}
              >
                {logoPath.split(/[/\\]/).pop()}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="branding-primary" style={labelStyle}>
                Primary Color
              </label>
              <input
                id="branding-primary"
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#FF0000"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="branding-secondary" style={labelStyle}>
                Secondary Color
              </label>
              <input
                id="branding-secondary"
                type="text"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                placeholder="#FFFFFF"
                style={inputStyle}
              />
            </div>
          </div>

          <V2Listbox
            label="Default Prompt Mode"
            value={promptMode}
            onChange={(v) => setPromptMode(v as "programmatic" | "deepseek")}
            options={[
              {
                value: "programmatic",
                label: "Programmatic",
                hint: "Deterministic template",
              },
              {
                value: "deepseek",
                label: "DeepSeek",
                hint: "LLM-authored prompt",
              },
            ]}
          />

          <div>
            <label htmlFor="branding-notes" style={labelStyle}>
              Extra Prompt Notes
            </label>
            <textarea
              id="branding-notes"
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {brandingError && (
            <div
              style={{
                padding: 12,
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 6,
                fontSize: 12,
                color: "#ef4444",
              }}
            >
              {brandingError}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={brandingSaving || logoUploading}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background:
                  brandingSaving || logoUploading ? "#666" : "var(--v2-accent)",
                border: "none",
                borderRadius: 8,
                cursor:
                  brandingSaving || logoUploading ? "not-allowed" : "pointer",
              }}
            >
              {brandingSaving ? "Saving..." : "Save Branding"}
            </button>
          </div>
        </GlassCard>
      </form>

      {/* Archetype links */}
      <GlassCard
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h3
          style={{ fontSize: 14, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Linked Archetypes
        </h3>
        {archetypes.length === 0 ? (
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            No archetypes exist yet — create one in the Archetypes tab.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {archetypes.map((a) => {
              const active = linkedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleLink(a.id)}
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 999,
                    cursor: "pointer",
                    border: active
                      ? "1px solid var(--v2-accent)"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                    background: active
                      ? "rgba(var(--v2-accent-rgb), 0.15)"
                      : "transparent",
                    color: active ? "var(--v2-accent)" : "#cdc3d7",
                  }}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        )}

        {linksError && (
          <div
            style={{
              padding: 12,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: 6,
              fontSize: 12,
              color: "#ef4444",
            }}
          >
            {linksError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleSaveLinks}
            disabled={linksSaving || archetypes.length === 0}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background:
                linksSaving || archetypes.length === 0
                  ? "#666"
                  : "var(--v2-accent)",
              border: "none",
              borderRadius: 8,
              cursor:
                linksSaving || archetypes.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {linksSaving ? "Saving..." : "Save Links"}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
