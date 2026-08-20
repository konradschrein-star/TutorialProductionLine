"use client";

/**
 * Preset Studio — full CaptionStyle editor with a live subtitle preview.
 *
 * Backed by cf_style_presets (see packages/db/src/schema/clip-forge.ts +
 * migration 0026_cf_style_presets_custom.sql). This screen owns the entire
 * CaptionStyle surface the renderer understands, so anything picked here
 * renders identically when a variant selects the preset.
 *
 * Layout:
 *   [ preset list | tabs + preview + knobs | actions ]
 *
 * Tabs:
 *   - Subtitle    — CaptionStyle for the word subtitles + phrase pacing
 *   - Caption pill — CaptionStyle for the top headline pill
 *   - Safe zones   — per-layoutKind subtitle_y / caption_y overrides
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionStyle } from "@repo/contracts";
import { SUBTITLE_STYLE_PRESETS, CAPTION_PILL_PRESETS } from "@repo/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LayoutKind =
  | "fullscreen-single"
  | "facecam-top-screen-bottom"
  | "stacked-facecams"
  | "top-fullscreen-bottom-facecam";

const LAYOUT_KINDS: LayoutKind[] = [
  "fullscreen-single",
  "top-fullscreen-bottom-facecam",
  "stacked-facecams",
  "facecam-top-screen-bottom",
];

interface SafeZone {
  subtitle_y?: number | null;
  caption_y?: number | null;
}

interface DbPreset {
  id: string;
  name: string;
  persona_id: string | null;
  subtitle_style_id: string | null;
  caption_style_id: string | null;
  subtitle_style: CaptionStyle | null;
  caption_style: CaptionStyle | null;
  layout_options: Record<string, unknown>;
  safe_zones: Partial<Record<LayoutKind, SafeZone>>;
  phrase_length_ms: number | null;
  caption_y: number | null;
  subtitle_y: number | null;
  caption_size: number | null;
  subtitle_size: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type TabId = "subtitle" | "caption" | "safezones";

// ---------------------------------------------------------------------------
// Sample data for the preview
// ---------------------------------------------------------------------------

const SAMPLE_WORDS: { word: string; start: number; end: number }[] = [
  { word: "PEOPLE", start: 0.0, end: 0.4 },
  { word: "DON'T", start: 0.4, end: 0.65 },
  { word: "BUY", start: 0.65, end: 0.9 },
  { word: "PRODUCTS", start: 0.95, end: 1.55 },
  { word: "THEY", start: 1.7, end: 1.9 },
  { word: "BUY", start: 1.9, end: 2.15 },
  { word: "BETTER", start: 2.2, end: 2.6 },
  { word: "VERSIONS", start: 2.6, end: 3.15 },
  { word: "OF", start: 3.15, end: 3.3 },
  { word: "THEMSELVES", start: 3.3, end: 4.0 },
];
const SAMPLE_LOOP_SEC = 4.6;
const SAMPLE_CAPTION = "The one rule every founder ignores";

const DEFAULT_SUBTITLE_STYLE: CaptionStyle = {
  activeColor: "#FFD700",
  inactiveColor: "#FFFFFF",
  fontSize: 2.2,
  activeFontSize: 2.4,
  fontFamily: "'Anton', Impact, 'Arial Black', sans-serif",
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  outlineWidth: 3,
  outlineColor: "#000000",
  animation: "karaoke-fill",
};

const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  activeColor: "#000000",
  inactiveColor: "#000000",
  fontSize: 1.8,
  activeFontSize: 2,
  fontFamily: "Montserrat, Inter, sans-serif",
  fontWeight: 800,
  background: "pill",
  backgroundColor: "#FFFFFF",
  textColorOnBackground: "#000000",
  animation: "spring-pop",
  textWrapMode: "scale-wrap",
  maxLines: 2,
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function PresetsScreen() {
  const [presets, setPresets] = useState<DbPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("subtitle");
  const [layoutKind, setLayoutKind] = useState<LayoutKind>("fullscreen-single");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Load presets on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/clip-forge/style-presets")
      .then((r) => r.json())
      .then((d: { presets?: DbPreset[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setLoadError(d.error);
          return;
        }
        setPresets(d.presets ?? []);
        if (d.presets && d.presets.length > 0) setSelectedId(d.presets[0].id);
      })
      .catch((e) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const current = presets.find((p) => p.id === selectedId) ?? null;

  const update = useCallback(
    (patch: Partial<DbPreset>) => {
      if (!current) return;
      setPresets((arr) =>
        arr.map((p) => (p.id === current.id ? { ...p, ...patch } : p)),
      );
      setDirty(true);
    },
    [current],
  );

  const patchSubtitleStyle = useCallback(
    (patch: Partial<CaptionStyle>) => {
      const base =
        current?.subtitle_style ??
        SUBTITLE_STYLE_PRESETS[current?.subtitle_style_id ?? ""] ??
        DEFAULT_SUBTITLE_STYLE;
      update({ subtitle_style: { ...base, ...patch } });
    },
    [current, update],
  );

  const patchCaptionStyle = useCallback(
    (patch: Partial<CaptionStyle>) => {
      const base =
        current?.caption_style ??
        CAPTION_PILL_PRESETS[current?.caption_style_id ?? ""] ??
        DEFAULT_CAPTION_STYLE;
      update({ caption_style: { ...base, ...patch } });
    },
    [current, update],
  );

  const patchSafeZone = useCallback(
    (kind: LayoutKind, patch: SafeZone) => {
      if (!current) return;
      const nextZones = {
        ...(current.safe_zones ?? {}),
        [kind]: { ...(current.safe_zones?.[kind] ?? {}), ...patch },
      };
      update({ safe_zones: nextZones });
    },
    [current, update],
  );

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/v1/clip-forge/style-presets/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: current.name,
          persona_id: current.persona_id,
          subtitle_style_id: current.subtitle_style_id,
          caption_style_id: current.caption_style_id,
          subtitle_style: current.subtitle_style,
          caption_style: current.caption_style,
          layout_options: current.layout_options,
          safe_zones: current.safe_zones,
          phrase_length_ms: current.phrase_length_ms,
          caption_y: current.caption_y,
          subtitle_y: current.subtitle_y,
          caption_size: current.caption_size,
          subtitle_size: current.subtitle_size,
          notes: current.notes,
        }),
      });
      const j = (await r.json()) as { preset?: DbPreset; error?: string };
      if (j.preset) {
        setPresets((arr) =>
          arr.map((p) => (p.id === current.id ? j.preset! : p)),
        );
        setDirty(false);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
      }
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const r = await fetch("/api/v1/clip-forge/style-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Preset ${presets.length + 1}`,
        subtitle_style: DEFAULT_SUBTITLE_STYLE,
        caption_style: DEFAULT_CAPTION_STYLE,
        phrase_length_ms: 1200,
      }),
    });
    const { preset } = (await r.json()) as { preset: DbPreset };
    setPresets((arr) => [preset, ...arr]);
    setSelectedId(preset.id);
    setDirty(false);
  };

  const duplicate = async () => {
    if (!current) return;
    const r = await fetch("/api/v1/clip-forge/style-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${current.name} (copy)`,
        persona_id: current.persona_id,
        subtitle_style_id: current.subtitle_style_id,
        caption_style_id: current.caption_style_id,
        subtitle_style: current.subtitle_style,
        caption_style: current.caption_style,
        layout_options: current.layout_options,
        safe_zones: current.safe_zones,
        phrase_length_ms: current.phrase_length_ms,
      }),
    });
    const { preset } = (await r.json()) as { preset: DbPreset };
    setPresets((arr) => [preset, ...arr]);
    setSelectedId(preset.id);
  };

  const remove = async () => {
    if (!current) return;
    if (!window.confirm(`Delete "${current.name}"?`)) return;
    await fetch(`/api/v1/clip-forge/style-presets/${current.id}`, {
      method: "DELETE",
    });
    const nextPresets = presets.filter((p) => p.id !== current.id);
    setPresets(nextPresets);
    setSelectedId(nextPresets[0]?.id ?? null);
  };

  // Resolved styles used by the live preview. Fall back to the hardcoded
  // registry so a preset with only *_style_id still previews.
  const previewSubtitleStyle: CaptionStyle = current?.subtitle_style
    ? current.subtitle_style
    : current?.subtitle_style_id
      ? (SUBTITLE_STYLE_PRESETS[current.subtitle_style_id] ??
        DEFAULT_SUBTITLE_STYLE)
      : DEFAULT_SUBTITLE_STYLE;
  const previewCaptionStyle: CaptionStyle = current?.caption_style
    ? current.caption_style
    : current?.caption_style_id
      ? (CAPTION_PILL_PRESETS[current.caption_style_id] ??
        DEFAULT_CAPTION_STYLE)
      : DEFAULT_CAPTION_STYLE;
  const phraseLengthMs = current?.phrase_length_ms ?? 1200;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <PresetList
        presets={presets}
        selectedId={selectedId}
        loadError={loadError}
        onSelect={(id) => {
          setSelectedId(id);
          setDirty(false);
        }}
        onNew={create}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #1d232a",
          overflow: "auto",
        }}
      >
        <TabRow
          tab={tab}
          setTab={setTab}
          layoutKind={layoutKind}
          setLayoutKind={setLayoutKind}
          currentName={current?.name}
        />

        {!current && <EmptyState onCreate={create} loadError={loadError} />}

        {current && (
          <div
            style={{
              flex: 1,
              display: "flex",
              gap: 22,
              padding: 20,
              minHeight: 0,
            }}
          >
            <SubtitlePreview
              subtitleStyle={previewSubtitleStyle}
              captionStyle={previewCaptionStyle}
              phraseLengthMs={phraseLengthMs}
              subtitleY={
                current.safe_zones?.[layoutKind]?.subtitle_y ??
                current.subtitle_y ??
                undefined
              }
              captionY={
                current.safe_zones?.[layoutKind]?.caption_y ??
                current.caption_y ??
                undefined
              }
              subtitleSize={current.subtitle_size ?? undefined}
              captionSize={current.caption_size ?? undefined}
              layoutKind={layoutKind}
            />

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 15,
                overflow: "auto",
                paddingRight: 4,
              }}
            >
              {tab === "subtitle" && (
                <SubtitleKnobs
                  style={previewSubtitleStyle}
                  phraseLengthMs={phraseLengthMs}
                  onStyle={patchSubtitleStyle}
                  onPhrase={(v) => update({ phrase_length_ms: v })}
                />
              )}
              {tab === "caption" && (
                <CaptionKnobs
                  style={previewCaptionStyle}
                  onStyle={patchCaptionStyle}
                />
              )}
              {tab === "safezones" && (
                <SafeZoneKnobs
                  layoutKind={layoutKind}
                  safeZones={current.safe_zones ?? {}}
                  onChange={patchSafeZone}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <ActionSidebar
        preset={current}
        dirty={dirty}
        saving={saving}
        savedFlash={savedFlash}
        onSave={save}
        onDuplicate={duplicate}
        onDelete={remove}
        onRename={(name) => update({ name })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left column: preset list
// ---------------------------------------------------------------------------

function PresetList({
  presets,
  selectedId,
  loadError,
  onSelect,
  onNew,
}: {
  presets: DbPreset[];
  selectedId: string | null;
  loadError: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div
      style={{
        width: 240,
        flex: "0 0 240px",
        borderRight: "1px solid #1d232a",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600 }}>Preset Library</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onNew}
          style={{
            border: "1px solid #3f4954",
            background: "#1a212a",
            color: "#eef1f4",
            borderRadius: 5,
            padding: "3px 9px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 10.5,
          }}
        >
          + new
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {loadError && (
          <div style={{ padding: 12, fontSize: 11, color: "#cf7468" }}>
            {loadError}
          </div>
        )}
        {presets.length === 0 && !loadError && (
          <div style={{ padding: 12, fontSize: 11, color: "#59616a" }}>
            No presets yet. Click <b>+ new</b> to create one.
          </div>
        )}
        {presets.map((p) => {
          const active = p.id === selectedId;
          const swatchA =
            p.subtitle_style?.activeColor ??
            SUBTITLE_STYLE_PRESETS[p.subtitle_style_id ?? ""]?.activeColor ??
            "#FFD700";
          const swatchB =
            p.subtitle_style?.inactiveColor ??
            SUBTITLE_STYLE_PRESETS[p.subtitle_style_id ?? ""]?.inactiveColor ??
            "#FFFFFF";
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                padding: "10px 13px 10px 11px",
                borderBottom: "1px solid #14181d",
                borderLeft: `2px solid ${active ? "#dfe3e8" : "transparent"}`,
                cursor: "pointer",
                background: active ? "#13181f" : "transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 5,
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    background: swatchA,
                    border: "1px solid #2b333c",
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    background: swatchB,
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#e6e9ed",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.name}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9.5,
                  color: "#6b727b",
                }}
              >
                <span>
                  {p.subtitle_style?.animation ??
                    SUBTITLE_STYLE_PRESETS[p.subtitle_style_id ?? ""]
                      ?.animation ??
                    "spring-pop"}
                </span>
                {p.phrase_length_ms ? (
                  <>
                    <span>·</span>
                    <span>{p.phrase_length_ms}ms/page</span>
                  </>
                ) : null}
                {p.persona_id ? (
                  <>
                    <span>·</span>
                    <span>persona</span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabRow({
  tab,
  setTab,
  layoutKind,
  setLayoutKind,
  currentName,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  layoutKind: LayoutKind;
  setLayoutKind: (k: LayoutKind) => void;
  currentName: string | undefined;
}) {
  const TABS: { id: TabId; label: string }[] = [
    { id: "subtitle", label: "Subtitle" },
    { id: "caption", label: "Caption pill" },
    { id: "safezones", label: "Safe zones" },
  ];
  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 16px",
        borderBottom: "1px solid #1d232a",
        background: "#0b0e12",
      }}
    >
      <div
        style={{
          display: "flex",
          border: "1px solid #2b333c",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {TABS.map((t, i) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                border: 0,
                borderLeft: i > 0 ? "1px solid #2b333c" : 0,
                background: active ? "#1a212a" : "transparent",
                color: active ? "#eef1f4" : "#7d8893",
                padding: "5px 11px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontSize: 9,
          letterSpacing: ".1em",
          color: "#59616a",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        PREVIEW LAYOUT
      </span>
      <select
        value={layoutKind}
        onChange={(e) => setLayoutKind(e.target.value as LayoutKind)}
        style={{
          background: "#1a212a",
          color: "#eef1f4",
          border: "1px solid #2b333c",
          borderRadius: 5,
          padding: "4px 8px",
          fontSize: 11,
          fontFamily: "inherit",
        }}
      >
        {LAYOUT_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {currentName && (
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: "#cfd4da",
            maxWidth: 200,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currentName}
        </span>
      )}
    </div>
  );
}

function EmptyState({
  onCreate,
  loadError,
}: {
  onCreate: () => void;
  loadError: string | null;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#59616a",
        flexDirection: "column",
        gap: 12,
        padding: 40,
      }}
    >
      {loadError ? (
        <>
          <span style={{ color: "#cf7468", fontSize: 13 }}>
            Failed to load presets: {loadError}
          </span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>No preset selected.</span>
          <button
            onClick={onCreate}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 6,
              padding: "7px 16px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            + create your first preset
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview stage — scaled-down 1080x1920 canvas with a rAF-driven timeline.
// Renders the same CaptionStyle knobs the composition does, so the picture
// stays honest to what the renderer will output.
// ---------------------------------------------------------------------------

const OUT_W = 1080;
const OUT_H = 1920;
const PREVIEW_W = 236;
const PREVIEW_SCALE = PREVIEW_W / OUT_W;
const PREVIEW_H = OUT_H * PREVIEW_SCALE;

interface Page {
  startMs: number;
  durationMs: number;
  tokens: { text: string; fromMs: number; toMs: number }[];
}

/**
 * Mirror of @remotion/captions' createTikTokStyleCaptions: pack tokens into
 * pages so no page spans more than combineTokensWithinMilliseconds.
 */
function groupIntoPages(
  words: { word: string; start: number; end: number }[],
  combineWithinMs: number,
): Page[] {
  if (words.length === 0) return [];
  const pages: Page[] = [];
  let cur: Page | null = null;
  for (const w of words) {
    const startMs = w.start * 1000;
    const endMs = w.end * 1000;
    if (!cur || startMs - cur.startMs >= combineWithinMs) {
      cur = {
        startMs,
        durationMs: endMs - startMs,
        tokens: [{ text: w.word + " ", fromMs: startMs, toMs: endMs }],
      };
      pages.push(cur);
    } else {
      cur.tokens.push({ text: w.word + " ", fromMs: startMs, toMs: endMs });
      cur.durationMs = endMs - cur.startMs;
    }
  }
  return pages;
}

function SubtitlePreview({
  subtitleStyle,
  captionStyle,
  phraseLengthMs,
  subtitleY,
  captionY,
  subtitleSize,
  captionSize,
  layoutKind,
}: {
  subtitleStyle: CaptionStyle;
  captionStyle: CaptionStyle;
  phraseLengthMs: number;
  subtitleY?: number;
  captionY?: number;
  subtitleSize?: number;
  captionSize?: number;
  layoutKind: LayoutKind;
}) {
  const [tMs, setTMs] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    startedAtRef.current = performance.now();
    const loopMs = SAMPLE_LOOP_SEC * 1000;
    const step = () => {
      const elapsed = performance.now() - startedAtRef.current;
      setTMs(elapsed % loopMs);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const pages = useMemo(
    () =>
      groupIntoPages(SAMPLE_WORDS, phraseLengthMs > 0 ? phraseLengthMs : 1200),
    [phraseLengthMs],
  );

  // Default caption / subtitle Y depend on the previewed layoutKind — mirror
  // the composition's V2 defaults roughly.
  const defaultCaptionY = layoutKind === "fullscreen-single" ? 60 : 40;
  const defaultSubtitleY =
    layoutKind === "fullscreen-single" ? OUT_H - 340 : OUT_H / 2 - 50;
  const cY = captionY ?? defaultCaptionY;
  const sY = subtitleY ?? defaultSubtitleY;
  const cSize = captionSize ?? 42;
  const sSize = subtitleSize ?? 82;

  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          position: "relative",
          width: PREVIEW_W,
          height: PREVIEW_H,
          borderRadius: 9,
          overflow: "hidden",
          backgroundImage:
            "repeating-linear-gradient(135deg,#1c222b 0 8px,#161b22 8px 16px)",
          border: "1px solid #2b333c",
          boxShadow: "0 14px 40px rgba(0,0,0,.5)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: OUT_W,
            height: OUT_H,
            transform: `scale(${PREVIEW_SCALE})`,
            transformOrigin: "top left",
          }}
        >
          <LayoutBackdrop kind={layoutKind} />
          <PreviewCaptionPill
            text={SAMPLE_CAPTION}
            topY={cY}
            fontSize={cSize}
            style={captionStyle}
          />
          <PreviewSubtitles
            pages={pages}
            tMs={tMs}
            topY={sY}
            fontSize={sSize}
            style={subtitleStyle}
          />
        </div>
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: "#59616a",
          display: "flex",
          gap: 10,
        }}
      >
        <span>{(tMs / 1000).toFixed(2)}s</span>
        <span>·</span>
        <span>{pages.length} pages</span>
        <span>·</span>
        <span>{subtitleStyle.animation ?? "spring-pop"}</span>
      </div>
    </div>
  );
}

function LayoutBackdrop({ kind }: { kind: LayoutKind }) {
  // Rough sketch of each layout kind so the safe-zone tab can see it.
  const stroke = "rgba(255,255,255,0.14)";
  const fill = "rgba(255,255,255,0.045)";
  const boxStyle = (
    x: number,
    y: number,
    w: number,
    h: number,
  ): React.CSSProperties => ({
    position: "absolute",
    left: x,
    top: y,
    width: w,
    height: h,
    border: `4px solid ${stroke}`,
    background: fill,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.28)",
    fontSize: 60,
    fontFamily: "sans-serif",
    fontWeight: 700,
  });
  switch (kind) {
    case "fullscreen-single":
      return <div style={boxStyle(60, 200, OUT_W - 120, OUT_H - 400)}>A</div>;
    case "top-fullscreen-bottom-facecam":
      return (
        <>
          <div style={boxStyle(60, 60, OUT_W - 120, OUT_H / 2 - 90)}>A</div>
          <div
            style={boxStyle(60, OUT_H / 2 + 30, OUT_W - 120, OUT_H / 2 - 90)}
          >
            B
          </div>
        </>
      );
    case "stacked-facecams":
      return (
        <>
          <div style={boxStyle(60, 60, OUT_W - 120, OUT_H / 2 - 90)}>A</div>
          <div
            style={boxStyle(60, OUT_H / 2 + 30, OUT_W - 120, OUT_H / 2 - 90)}
          >
            B
          </div>
        </>
      );
    case "facecam-top-screen-bottom":
      return (
        <>
          <div style={boxStyle(60, 60, OUT_W - 120, OUT_H / 3 - 30)}>A</div>
          <div
            style={boxStyle(
              60,
              OUT_H / 3 + 60,
              OUT_W - 120,
              (OUT_H * 2) / 3 - 120,
            )}
          >
            SCREEN
          </div>
        </>
      );
  }
}

function PreviewCaptionPill({
  text,
  topY,
  fontSize,
  style,
}: {
  text: string;
  topY: number;
  fontSize: number;
  style: CaptionStyle;
}) {
  const onBg = style.background === "pill" || style.background === "box";
  const color =
    (onBg && style.textColorOnBackground) || style.inactiveColor || "#FFFFFF";
  return (
    <div
      style={{
        position: "absolute",
        top: topY,
        left: "50%",
        transform: "translateX(-50%)",
        color,
        fontFamily: style.fontFamily ?? "Montserrat, Inter, sans-serif",
        fontWeight: style.fontWeight ?? 900,
        fontSize,
        letterSpacing: style.letterSpacing ?? "-0.01em",
        textTransform: style.textTransform ?? "uppercase",
        textAlign: "center",
        maxWidth: OUT_W - 140,
        background: onBg
          ? (style.backgroundColor ?? "transparent")
          : "transparent",
        padding: onBg ? "16px 28px" : 0,
        borderRadius:
          style.background === "pill" ? 18 : style.background === "box" ? 4 : 0,
        boxShadow: onBg ? "0 6px 18px rgba(0,0,0,0.4)" : undefined,
        textShadow: buildTextShadow(style),
        lineHeight: 1.18,
        whiteSpace: "normal",
        zIndex: 200,
      }}
    >
      {text}
    </div>
  );
}

function PreviewSubtitles({
  pages,
  tMs,
  topY,
  fontSize,
  style,
}: {
  pages: Page[];
  tMs: number;
  topY: number;
  fontSize: number;
  style: CaptionStyle;
}) {
  if (pages.length === 0) return null;
  let activePage: Page | null = null;
  for (const p of pages) {
    if (tMs >= p.startMs) activePage = p;
    else break;
  }
  if (!activePage) return null;
  const pageEndMs = activePage.startMs + activePage.durationMs + 200;
  if (tMs >= pageEndMs) return null;

  let activeIdx = -1;
  for (let i = 0; i < activePage.tokens.length; i++) {
    if (tMs >= activePage.tokens[i].fromMs) activeIdx = i;
    else break;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: topY,
        left: 0,
        width: OUT_W,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        boxSizing: "border-box",
        zIndex: 150,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 0,
          maxWidth: OUT_W - 140,
        }}
      >
        {activePage.tokens.map((tok, i) => {
          const isActive = i === activeIdx;
          const localMs = isActive ? tMs - tok.fromMs : 0;
          const durationMs = Math.max(1, tok.toMs - tok.fromMs);
          const activeProgress = isActive
            ? Math.min(1, Math.max(0, localMs / durationMs))
            : 0;
          const appearProgress = isActive
            ? Math.min(1, Math.max(0, localMs / 250))
            : 1;
          return (
            <PreviewToken
              key={i}
              text={tok.text}
              isActive={isActive}
              activeProgress={activeProgress}
              appearProgress={appearProgress}
              style={style}
              fontSize={fontSize}
            />
          );
        })}
      </div>
    </div>
  );
}

function PreviewToken({
  text,
  isActive,
  activeProgress,
  appearProgress,
  style,
  fontSize,
}: {
  text: string;
  isActive: boolean;
  activeProgress: number;
  appearProgress: number;
  style: CaptionStyle;
  fontSize: number;
}) {
  const animKind = style.animation ?? "spring-pop";
  const baseInactive = style.inactiveColor ?? "#FFFFFF";
  const baseActive = style.activeColor ?? baseInactive;

  let scale = 1;
  let translateY = 0;
  let opacity = 1;
  if (isActive) {
    if (animKind === "spring-pop" || animKind === "word-pop") {
      scale = 0.9 + 0.1 * appearProgress;
      opacity = 0.4 + 0.6 * appearProgress;
    } else if (animKind === "bounce-in") {
      const p = appearProgress;
      scale =
        p < 0.55
          ? 0.7 + (1.18 - 0.7) * (p / 0.55)
          : 1.18 + (1 - 1.18) * ((p - 0.55) / 0.45);
      opacity = 0.3 + 0.7 * p;
    } else if (animKind === "fade-up") {
      translateY = 18 * (1 - appearProgress);
      opacity = appearProgress;
    }
  }

  const wantsKaraoke = isActive && animKind === "karaoke-fill";
  let background: string | undefined;
  let webkitBackgroundClip: string | undefined;
  let webkitTextFillColor: string | undefined;
  let textColor = isActive ? baseActive : baseInactive;
  if (wantsKaraoke) {
    const pct = Math.max(0, Math.min(1, activeProgress)) * 100;
    background = `linear-gradient(90deg, ${baseActive} ${pct}%, ${baseInactive} ${pct}%)`;
    webkitBackgroundClip = "text";
    webkitTextFillColor = "transparent";
  }

  const hl = !wantsKaraoke && isActive ? style.highlightBackgroundColor : null;
  const hlPadX = style.highlightBackgroundPadding?.x ?? 12;
  const hlPadY = style.highlightBackgroundPadding?.y ?? 4;

  return (
    <span
      style={{
        display: "inline-block",
        fontFamily:
          style.fontFamily ??
          "Montserrat, 'Anton', Impact, 'Arial Black', sans-serif",
        fontWeight: style.fontWeight ?? 900,
        fontSize,
        color: textColor,
        textTransform: style.textTransform ?? "uppercase",
        letterSpacing: style.letterSpacing ?? "0.02em",
        backgroundColor: hl ?? undefined,
        padding: hl ? `${hlPadY}px ${hlPadX}px` : 0,
        borderRadius: hl ? 8 : 0,
        background,
        WebkitBackgroundClip: webkitBackgroundClip,
        WebkitTextFillColor: webkitTextFillColor,
        backgroundClip: webkitBackgroundClip ? "text" : undefined,
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        textShadow: buildTextShadow(style),
        lineHeight: 1.04,
        whiteSpace: "pre",
      }}
    >
      {text}
    </span>
  );
}

function buildTextShadow(style: CaptionStyle): string | undefined {
  const parts: string[] = [];
  const w = style.outlineWidth ?? 0;
  if (w > 0) {
    const c = style.outlineColor ?? "#000000";
    parts.push(
      `-${w}px -${w}px 0 ${c}`,
      `${w}px -${w}px 0 ${c}`,
      `-${w}px ${w}px 0 ${c}`,
      `${w}px ${w}px 0 ${c}`,
      `0 -${w}px 0 ${c}`,
      `0 ${w}px 0 ${c}`,
      `-${w}px 0 0 ${c}`,
      `${w}px 0 0 ${c}`,
      `0 ${w * 2}px ${w * 4}px rgba(0,0,0,0.4)`,
    );
  }
  if (style.shadow) {
    const s = style.shadow;
    parts.push(`${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.color}`);
  }
  if (style.glow) {
    parts.push(`0 0 ${style.glow.blur}px ${style.glow.color}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// ---------------------------------------------------------------------------
// Knob panes
// ---------------------------------------------------------------------------

const ANIMATIONS = [
  "spring-pop",
  "word-pop",
  "karaoke-fill",
  "fade-up",
  "bounce-in",
  "none",
] as const;

const TEXT_TRANSFORMS = [
  "uppercase",
  "lowercase",
  "capitalize",
  "none",
] as const;

const BG_KINDS = ["none", "pill", "box"] as const;

const FONT_FAMILIES = [
  "'Anton', Impact, 'Arial Black', sans-serif",
  "'Komika Axis', Impact, 'Arial Black', sans-serif",
  "Impact, 'Arial Black', sans-serif",
  "Montserrat, Inter, sans-serif",
  "'Bebas Neue', Impact, sans-serif",
  "'Barlow Condensed', Impact, sans-serif",
] as const;

function SubtitleKnobs({
  style,
  phraseLengthMs,
  onStyle,
  onPhrase,
}: {
  style: CaptionStyle;
  phraseLengthMs: number;
  onStyle: (patch: Partial<CaptionStyle>) => void;
  onPhrase: (v: number) => void;
}) {
  return (
    <>
      <Row label="Phrase length">
        <input
          type="range"
          min={400}
          max={4000}
          step={100}
          value={phraseLengthMs}
          onChange={(e) => onPhrase(+e.target.value)}
          style={{ flex: 1 }}
        />
        <NumericChip value={`${phraseLengthMs}ms`} />
      </Row>
      <Row label="Animation">
        <ChipRow
          values={ANIMATIONS as unknown as string[]}
          value={style.animation ?? "spring-pop"}
          onChange={(v) =>
            onStyle({ animation: v as CaptionStyle["animation"] })
          }
        />
      </Row>
      <Row label="Active color">
        <ColorInput
          value={style.activeColor ?? "#FFD700"}
          onChange={(v) => onStyle({ activeColor: v })}
        />
      </Row>
      <Row label="Inactive color">
        <ColorInput
          value={style.inactiveColor ?? "#FFFFFF"}
          onChange={(v) => onStyle({ inactiveColor: v })}
        />
      </Row>
      <Row label="Highlight box">
        <ColorInput
          value={style.highlightBackgroundColor ?? ""}
          onChange={(v) =>
            onStyle({ highlightBackgroundColor: v || undefined })
          }
          allowClear
        />
      </Row>
      <Row label="Font family">
        <select
          value={style.fontFamily ?? FONT_FAMILIES[0]}
          onChange={(e) => onStyle({ fontFamily: e.target.value })}
          style={selectStyle}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.split(",")[0].replace(/'/g, "")}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Font weight">
        <input
          type="range"
          min={300}
          max={900}
          step={100}
          value={style.fontWeight ?? 900}
          onChange={(e) => onStyle({ fontWeight: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip value={String(style.fontWeight ?? 900)} />
      </Row>
      <Row label="Text case">
        <ChipRow
          values={TEXT_TRANSFORMS as unknown as string[]}
          value={style.textTransform ?? "uppercase"}
          onChange={(v) =>
            onStyle({ textTransform: v as CaptionStyle["textTransform"] })
          }
        />
      </Row>
      <Row label="Outline width">
        <input
          type="range"
          min={0}
          max={10}
          value={style.outlineWidth ?? 0}
          onChange={(e) => onStyle({ outlineWidth: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip value={`${style.outlineWidth ?? 0}px`} />
      </Row>
      <Row label="Outline color">
        <ColorInput
          value={style.outlineColor ?? "#000000"}
          onChange={(v) => onStyle({ outlineColor: v })}
        />
      </Row>
      <Row label="Letter spacing">
        <input
          type="text"
          value={style.letterSpacing ?? "0.02em"}
          onChange={(e) => onStyle({ letterSpacing: e.target.value })}
          style={{
            flex: 1,
            background: "#0f141a",
            color: "#eef1f4",
            border: "1px solid #2b333c",
            borderRadius: 5,
            padding: "5px 8px",
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        />
      </Row>
    </>
  );
}

function CaptionKnobs({
  style,
  onStyle,
}: {
  style: CaptionStyle;
  onStyle: (patch: Partial<CaptionStyle>) => void;
}) {
  return (
    <>
      <Row label="Background">
        <ChipRow
          values={BG_KINDS as unknown as string[]}
          value={style.background ?? "none"}
          onChange={(v) =>
            onStyle({ background: v as CaptionStyle["background"] })
          }
        />
      </Row>
      <Row label="Pill color">
        <ColorInput
          value={style.backgroundColor ?? "#FFFFFF"}
          onChange={(v) => onStyle({ backgroundColor: v })}
        />
      </Row>
      <Row label="Text on pill">
        <ColorInput
          value={style.textColorOnBackground ?? "#000000"}
          onChange={(v) => onStyle({ textColorOnBackground: v })}
        />
      </Row>
      <Row label="Font family">
        <select
          value={style.fontFamily ?? FONT_FAMILIES[3]}
          onChange={(e) => onStyle({ fontFamily: e.target.value })}
          style={selectStyle}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.split(",")[0].replace(/'/g, "")}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Font weight">
        <input
          type="range"
          min={300}
          max={900}
          step={100}
          value={style.fontWeight ?? 800}
          onChange={(e) => onStyle({ fontWeight: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip value={String(style.fontWeight ?? 800)} />
      </Row>
      <Row label="Text case">
        <ChipRow
          values={TEXT_TRANSFORMS as unknown as string[]}
          value={style.textTransform ?? "uppercase"}
          onChange={(v) =>
            onStyle({ textTransform: v as CaptionStyle["textTransform"] })
          }
        />
      </Row>
      <Row label="Outline width">
        <input
          type="range"
          min={0}
          max={10}
          value={style.outlineWidth ?? 0}
          onChange={(e) => onStyle({ outlineWidth: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip value={`${style.outlineWidth ?? 0}px`} />
      </Row>
      <Row label="Outline color">
        <ColorInput
          value={style.outlineColor ?? "#000000"}
          onChange={(v) => onStyle({ outlineColor: v })}
        />
      </Row>
      <Row label="Max lines">
        <input
          type="range"
          min={1}
          max={3}
          value={style.maxLines ?? 2}
          onChange={(e) => onStyle({ maxLines: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip value={String(style.maxLines ?? 2)} />
      </Row>
    </>
  );
}

function SafeZoneKnobs({
  layoutKind,
  safeZones,
  onChange,
}: {
  layoutKind: LayoutKind;
  safeZones: Partial<Record<LayoutKind, SafeZone>>;
  onChange: (k: LayoutKind, p: SafeZone) => void;
}) {
  const cur = safeZones[layoutKind] ?? {};
  return (
    <>
      <div style={{ fontSize: 11, color: "#7d8893" }}>
        Overrides for <b>{layoutKind}</b>. Leave empty to use the
        composition&apos;s default position for this layout kind.
      </div>
      <Row label="Subtitle Y">
        <input
          type="range"
          min={0}
          max={OUT_H - 100}
          value={cur.subtitle_y ?? Math.round(OUT_H / 2)}
          onChange={(e) =>
            onChange(layoutKind, { subtitle_y: +e.target.value })
          }
          style={{ flex: 1 }}
        />
        <NumericChip
          value={cur.subtitle_y == null ? "auto" : `${cur.subtitle_y}px`}
        />
        <ClearButton
          onClick={() => onChange(layoutKind, { subtitle_y: null })}
        />
      </Row>
      <Row label="Caption Y">
        <input
          type="range"
          min={0}
          max={OUT_H - 100}
          value={cur.caption_y ?? 60}
          onChange={(e) => onChange(layoutKind, { caption_y: +e.target.value })}
          style={{ flex: 1 }}
        />
        <NumericChip
          value={cur.caption_y == null ? "auto" : `${cur.caption_y}px`}
        />
        <ClearButton
          onClick={() => onChange(layoutKind, { caption_y: null })}
        />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------------------
// Right column: preset actions
// ---------------------------------------------------------------------------

function ActionSidebar({
  preset,
  dirty,
  saving,
  savedFlash,
  onSave,
  onDuplicate,
  onDelete,
  onRename,
}: {
  preset: DbPreset | null;
  dirty: boolean;
  saving: boolean;
  savedFlash: boolean;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (n: string) => void;
}) {
  return (
    <div
      style={{
        width: 316,
        flex: "0 0 316px",
        overflow: "auto",
        padding: "15px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {!preset && (
        <div style={{ fontSize: 11, color: "#59616a" }}>
          Select a preset to see its actions.
        </div>
      )}
      {preset && (
        <>
          <div>
            <div style={monoLabelStyle}>NAME</div>
            <input
              value={preset.name}
              onChange={(e) => onRename(e.target.value)}
              style={{
                width: "100%",
                background: "#0f141a",
                color: "#eef1f4",
                border: "1px solid #2b333c",
                borderRadius: 5,
                padding: "6px 9px",
                fontFamily: "inherit",
                fontSize: 12,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <div style={monoLabelStyle}>METADATA</div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: "#7d8893",
                lineHeight: 1.6,
              }}
            >
              <div>id: {preset.id.slice(0, 8)}…</div>
              <div>persona: {preset.persona_id ? "scoped" : "global"}</div>
              <div>
                updated:{" "}
                {new Date(preset.updated_at).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderTop: "1px solid #1d232a",
              paddingTop: 13,
            }}
          >
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              style={{
                border: dirty ? "1px solid #57a578" : "1px solid #2b333c",
                background: dirty ? "#12261a" : "#1a212a",
                color: dirty ? "#dff2e6" : "#7d8893",
                borderRadius: 6,
                padding: 9,
                cursor: dirty && !saving ? "pointer" : "default",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {savedFlash
                ? "✓ saved"
                : saving
                  ? "saving…"
                  : dirty
                    ? "save changes"
                    : "no changes"}
            </button>
            <button onClick={onDuplicate} style={secondaryBtnStyle}>
              duplicate
            </button>
            <button
              onClick={onDelete}
              style={{ ...secondaryBtnStyle, color: "#cf7468" }}
            >
              delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

const monoLabelStyle: React.CSSProperties = {
  fontSize: 9.5,
  letterSpacing: ".12em",
  color: "#59616a",
  fontFamily: "'IBM Plex Mono', monospace",
  marginBottom: 9,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: "#0f141a",
  color: "#eef1f4",
  border: "1px solid #2b333c",
  borderRadius: 5,
  padding: "5px 8px",
  fontSize: 11,
  fontFamily: "inherit",
};

const secondaryBtnStyle: React.CSSProperties = {
  border: "1px solid #2b333c",
  background: "transparent",
  color: "#aeb4bb",
  borderRadius: 6,
  padding: 8,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11.5,
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 110,
          fontSize: 11,
          color: "#9aa1a9",
          flex: "0 0 110px",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function NumericChip({ value }: { value: string }) {
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        color: "#cfd4da",
        minWidth: 56,
        textAlign: "right",
      }}
    >
      {value}
    </span>
  );
}

function ChipRow({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {values.map((v) => {
        const active = v === value;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              fontSize: 10.5,
              fontFamily: "'IBM Plex Mono', monospace",
              border: `1px solid ${active ? "#3f4954" : "#2b333c"}`,
              background: active ? "#1a212a" : "transparent",
              color: active ? "#eef1f4" : "#7d8893",
              borderRadius: 5,
              padding: "4px 9px",
              cursor: "pointer",
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

function ColorInput({
  value,
  onChange,
  allowClear,
}: {
  value: string;
  onChange: (v: string) => void;
  allowClear?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
      <input
        type="color"
        value={value || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 32,
          height: 26,
          border: "1px solid #2b333c",
          borderRadius: 5,
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#______"
        style={{
          flex: 1,
          background: "#0f141a",
          color: "#eef1f4",
          border: "1px solid #2b333c",
          borderRadius: 5,
          padding: "5px 8px",
          fontSize: 11,
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      />
      {allowClear && value && (
        <button
          onClick={() => onChange("")}
          style={{
            border: "1px solid #2b333c",
            background: "transparent",
            color: "#7d8893",
            borderRadius: 4,
            padding: "3px 6px",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          clear
        </button>
      )}
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "1px solid #2b333c",
        background: "transparent",
        color: "#7d8893",
        borderRadius: 4,
        padding: "3px 6px",
        fontSize: 10,
        cursor: "pointer",
      }}
    >
      clear
    </button>
  );
}
