"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  RemotionConfigSchema,
  FfmpegConfigSchema,
  defaultRemotionConfig,
  defaultFfmpegConfig,
  type RemotionSubtitleConfig,
  type FFmpegSubtitleConfig,
} from "@repo/db/subtitles";
import { GlassCard } from "../../_components/glass-card";
import { Section } from "@/components/subtitles/primitives";
import { LivePreview } from "@/components/subtitles/LivePreview";
import {
  SubtitleFontFaceStyles,
  useSubtitleFonts,
} from "@/components/subtitles/font-faces";
import { FontControls } from "@/components/subtitles/controls/FontControls";
import { SecondaryFontControls } from "@/components/subtitles/controls/SecondaryFontControls";
import { CaptionControls } from "@/components/subtitles/controls/CaptionControls";
import { KeywordControls } from "@/components/subtitles/controls/KeywordControls";
import { AnimationControls } from "@/components/subtitles/controls/AnimationControls";
import { BackgroundControls } from "@/components/subtitles/controls/BackgroundControls";
import { SpeakerControls } from "@/components/subtitles/controls/SpeakerControls";
import { FfmpegControls } from "@/components/subtitles/controls/FfmpegControls";
import type { SubtitleFont } from "@/components/subtitles/controls/types";

type Engine = "remotion" | "ffmpeg";
type Preset = {
  id: string;
  name: string;
  description: string | null;
  engine: Engine;
  config: unknown;
  is_built_in: boolean;
  is_locked: boolean;
};

/**
 * Parse the persisted config into the v2 shape.
 *
 * A config that does not parse still opens the editor on engine defaults so the
 * preset is recoverable, but it reports WHAT was wrong — silently swapping in
 * defaults would show a preview that has nothing to do with the stored preset.
 */
function seedConfig(
  engine: Engine,
  raw: unknown,
): {
  config: RemotionSubtitleConfig | FFmpegSubtitleConfig;
  configError: string | null;
} {
  const schema =
    engine === "remotion" ? RemotionConfigSchema : FfmpegConfigSchema;
  const fallback =
    engine === "remotion" ? defaultRemotionConfig : defaultFfmpegConfig;
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return {
      config: parsed.data as RemotionSubtitleConfig | FFmpegSubtitleConfig,
      configError: null,
    };
  }
  const first = parsed.error.issues[0];
  return {
    config: fallback,
    configError: first
      ? `Stored config is invalid (${first.path.join(".") || "(root)"}: ${first.message}). Showing engine defaults — saving will overwrite the stored config.`
      : "Stored config is invalid. Showing engine defaults.",
  };
}

export default function SubtitlePresetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [preset, setPreset] = useState<Preset | null>(null);
  const [config, setConfig] = useState<
    RemotionSubtitleConfig | FFmpegSubtitleConfig | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const fontsState = useSubtitleFonts();
  const fonts: SubtitleFont[] = fontsState.fonts;

  useEffect(() => {
    fetch(`/api/v1/subtitle-presets/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? `Preset request failed (${r.status})`);
        }
        return r.json();
      })
      .then((p: Preset) => {
        setPreset(p);
        const seeded = seedConfig(p.engine, p.config);
        setConfig(seeded.config);
        setConfigError(seeded.configError);
      })
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e)),
      );
  }, [id]);

  const locked = preset?.is_locked ?? false;
  const readOnly = locked;
  const isRemotion = preset?.engine === "remotion";

  // Both engines store the SAME canonical caption style, so there is one config
  // object; `engine` only decides which renderer burns it in and therefore
  // which control sections are offered.
  const cfg = config as RemotionSubtitleConfig | null;
  const remotionCfg = isRemotion ? cfg : null;
  const ffmpegCfg = !isRemotion ? cfg : null;

  const patchRemotion = (patch: Partial<RemotionSubtitleConfig>) =>
    setConfig((c) => (c ? ({ ...c, ...patch } as RemotionSubtitleConfig) : c));
  const patchFfmpeg = (patch: Partial<FFmpegSubtitleConfig>) =>
    setConfig((c) => (c ? ({ ...c, ...patch } as FFmpegSubtitleConfig) : c));

  const save = async () => {
    if (!preset || !config) return;
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/v1/subtitle-presets/${preset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: preset.name,
        description: preset.description,
        engine: preset.engine,
        config,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body?.error ?? `Save failed (${res.status})`);
    }
    setSaving(false);
  };

  const clone = async () => {
    if (!preset || !config) return;
    const res = await fetch("/api/v1/subtitle-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${preset.name} (copy)`,
        description: preset.description,
        engine: preset.engine,
        config,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body?.error ?? `Clone failed (${res.status})`);
      return;
    }
    const cloned = await res.json();
    router.push(`/subtitles/${cloned.id}`);
  };

  const setLocked = async (next: boolean) => {
    if (!preset) return;
    setLockBusy(true);
    setSaveError(null);
    const res = await fetch(`/api/v1/subtitle-presets/${preset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: next }),
    });
    if (res.ok) {
      setPreset((p) => (p ? { ...p, is_locked: next } : p));
    } else {
      const body = await res.json().catch(() => ({}));
      setSaveError(body?.error ?? `Could not change lock (${res.status})`);
    }
    setLockBusy(false);
  };

  if (loadError)
    return (
      <div style={{ padding: 32 }}>
        <GlassCard
          style={{
            padding: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid rgba(255,138,138,0.35)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, color: "#ff8a8a" }}
          >
            error
          </span>
          <div>
            <div style={{ fontSize: 14, color: "#ff8a8a", fontWeight: 600 }}>
              Could not load this preset
            </div>
            <div style={{ fontSize: 12, color: "#cdc3d7", marginTop: 4 }}>
              {loadError}
            </div>
          </div>
        </GlassCard>
      </div>
    );

  if (!preset || !config)
    return <div style={{ padding: 32, color: "#cdc3d7" }}>Loading...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <SubtitleFontFaceStyles fonts={fontsState.fonts} />
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#cdc3d7", marginBottom: 4 }}>
            <Link href="/subtitles" style={{ color: "var(--v2-accent)" }}>
              Subtitle Presets
            </Link>{" "}
            / {preset.name}
          </div>
          <input
            value={preset.name}
            onChange={(e) =>
              setPreset((p) => (p ? { ...p, name: e.target.value } : p))
            }
            disabled={readOnly}
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#e5e2e1",
              background: "none",
              border: "none",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 11, color: "#cdc3d7", marginTop: 2 }}>
            Engine: {preset.engine}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saveError && (
            <span style={{ fontSize: 12, color: "#ff8a8a", maxWidth: 320 }}>
              {saveError}
            </span>
          )}

          {/* Clone is always a first-class action, locked or not. */}
          <button
            onClick={clone}
            title="Create an editable copy of this preset"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(var(--v2-accent-rgb),0.4)",
              background: "transparent",
              color: "var(--v2-accent)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 17 }}
            >
              content_copy
            </span>
            Clone
          </button>

          <button
            onClick={save}
            disabled={saving || locked}
            title={
              locked ? "Preset is locked — unlock or clone to edit" : "Save"
            }
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "none",
              background: locked
                ? "rgba(255,255,255,0.08)"
                : "var(--v2-accent)",
              color: locked ? "#8a8594" : "#fff",
              cursor: locked ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>

          {/* Lock toggle — top right, per spec. */}
          <button
            onClick={() => setLocked(!locked)}
            disabled={lockBusy}
            title={
              locked
                ? "Unlock this preset to edit it in place"
                : "Lock this preset so it can only be changed via a clone"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: locked
                ? "1px solid rgba(255,196,120,0.5)"
                : "1px solid rgba(var(--v2-accent-rgb),0.25)",
              background: locked ? "rgba(255,196,120,0.12)" : "transparent",
              color: locked ? "#ffc478" : "#cdc3d7",
              cursor: lockBusy ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              {locked ? "lock" : "lock_open"}
            </span>
            {locked ? "Locked" : "Unlocked"}
          </button>
        </div>
      </div>

      {locked && (
        <div
          style={{
            padding: "16px 18px",
            marginBottom: 20,
            borderRadius: 12,
            border: "1px solid rgba(255,196,120,0.45)",
            background: "rgba(255,196,120,0.10)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: "#ffc478" }}
          >
            lock
          </span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#ffc478",
                marginBottom: 3,
              }}
            >
              This preset is locked — every control below is disabled
            </div>
            <div style={{ fontSize: 13, color: "#e5e2e1", lineHeight: 1.45 }}>
              {preset.is_built_in ? "It ships as a built-in. " : ""}
              <strong>Clone</strong> it to make your own editable copy, or{" "}
              <strong>Unlock</strong> it to edit this one in place.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={clone}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: "var(--v2-accent)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                content_copy
              </span>
              Clone to customize
            </button>
            <button
              onClick={() => setLocked(false)}
              disabled={lockBusy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid rgba(255,196,120,0.6)",
                background: "transparent",
                color: "#ffc478",
                cursor: lockBusy ? "wait" : "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18 }}
              >
                lock_open
              </span>
              Unlock
            </button>
          </div>
        </div>
      )}

      {configError && (
        <GlassCard
          style={{
            padding: 12,
            marginBottom: 20,
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
            report
          </span>
          <span style={{ fontSize: 12, color: "#ff8a8a" }}>{configError}</span>
        </GlassCard>
      )}

      {fontsState.status === "error" && (
        <GlassCard
          style={{
            padding: 12,
            marginBottom: 20,
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
            Font registry could not be loaded ({fontsState.error}). The preview
            is rendering in a fallback typeface, NOT this preset&apos;s real
            font.
          </span>
        </GlassCard>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "400px 1fr",
          gap: 24,
          alignItems: "start",
        }}
      >
        {/* Left — controls */}
        <GlassCard
          style={{ padding: 20, display: "flex", flexDirection: "column" }}
        >
          {isRemotion && remotionCfg ? (
            <>
              <Section title="Font">
                <FontControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                  fonts={fonts}
                />
              </Section>
              <Section title="Secondary Font" defaultOpen={false}>
                <SecondaryFontControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                  fonts={fonts}
                />
              </Section>
              <Section title="Caption">
                <CaptionControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                />
              </Section>
              <Section title="Keyword Highlights" defaultOpen={false}>
                <KeywordControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                />
              </Section>
              <Section title="Animations" defaultOpen={false}>
                <AnimationControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                />
              </Section>
              <Section title="Background" defaultOpen={false}>
                <BackgroundControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                />
              </Section>
              <Section title="Speakers" defaultOpen={false}>
                <SpeakerControls
                  config={remotionCfg}
                  onChange={patchRemotion}
                  disabled={readOnly}
                />
              </Section>
            </>
          ) : (
            ffmpegCfg && (
              <Section title="FFmpeg Subtitles">
                <FfmpegControls
                  config={ffmpegCfg}
                  onChange={patchFfmpeg}
                  disabled={readOnly}
                  fonts={fonts}
                />
              </Section>
            )
          )}
        </GlassCard>

        {/* Right — preview */}
        <GlassCard
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#e5e2e1",
              margin: 0,
            }}
          >
            Live Preview
          </h3>
          {/* One preview for BOTH engines. Both now consume the same
              canonical config, and the ASS engine is built to match this
              renderer, so a hand-rolled DOM approximation for `ffmpeg` would
              only reintroduce the editor-vs-render mismatch it used to cause.
              The libass-specific caveats are listed in the controls panel. */}
          {cfg && <LivePreview config={cfg} aspect="9:16" />}
        </GlassCard>
      </div>
    </div>
  );
}
