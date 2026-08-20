"use client";

import { useEffect, useMemo, useState } from "react";
import { SUBTITLE_STYLE_PRESETS, CAPTION_PILL_PRESETS } from "@repo/contracts";
import type { ScreenId } from "../_lib/types";

const SUBTITLE_OPTIONS = Object.keys(SUBTITLE_STYLE_PRESETS);
const CAPTION_OPTIONS = Object.keys(CAPTION_PILL_PRESETS);

type FullscreenFit = "auto" | "cover" | "contain-center";

interface VariantRow {
  id: string;
  raw_clip_id: string;
  variant_seed: number;
  layout_preset: "fullscreen" | "zones" | null;
  subtitle_style_id: string | null;
  caption_style_id: string | null;
  caption_text: string | null;
  layout_options: Record<string, unknown> | null;
  rendered_mp4_key: string | null;
}

interface StylePreset {
  id: string;
  name: string;
  persona_id: string | null;
  subtitle_style_id: string | null;
  caption_style_id: string | null;
  layout_options: Record<string, unknown> | null;
  caption_y: number | null;
  subtitle_y: number | null;
  caption_size: number | null;
  subtitle_size: number | null;
}

interface Props {
  setScreen: (s: ScreenId) => void;
  variantId: string | null;
}

export function StudioScreen({ setScreen, variantId }: Props) {
  const [variant, setVariant] = useState<VariantRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [status, setStatus] = useState<string>("");

  const [layoutPreset, setLayoutPreset] = useState<"fullscreen" | "zones">(
    "fullscreen",
  );
  const [subtitleStyleId, setSubtitleStyleId] =
    useState<string>("impact-white");
  const [captionStyleId, setCaptionStyleId] =
    useState<string>("white-pill-black");
  const [captionText, setCaptionText] = useState<string>("");
  const [fullscreenFit, setFullscreenFit] = useState<FullscreenFit>("auto");
  const [showFrames, setShowFrames] = useState<boolean>(true);
  const [showHitboxes, setShowHitboxes] = useState<boolean>(false);
  const [captionY, setCaptionY] = useState<number | "">("");
  const [subtitleY, setSubtitleY] = useState<number | "">("");
  const [captionSize, setCaptionSize] = useState<number | "">("");
  const [subtitleSize, setSubtitleSize] = useState<number | "">("");
  const [captionStartSec, setCaptionStartSec] = useState<number | "">("");
  const [captionEndSec, setCaptionEndSec] = useState<number | "">("");
  const [presetName, setPresetName] = useState<string>("");

  // Load the active variant and the available style presets.
  useEffect(() => {
    if (!variantId) {
      setVariant(null);
      return;
    }
    setLoading(true);
    setStatus("Loading variant…");
    Promise.all([
      fetch(`/api/v1/clip-forge/variants/${variantId}`).then(async (r) => {
        if (!r.ok) throw new Error(`variant load ${r.status}`);
        return r.json() as Promise<{ variant: VariantRow }>;
      }),
      fetch(`/api/v1/clip-forge/style-presets`).then(
        (r) => r.json() as Promise<{ presets: StylePreset[] }>,
      ),
    ])
      .then(([v, p]) => {
        setVariant(v.variant);
        setPresets(p.presets ?? []);
        setStatus("");
      })
      .catch((e) => setStatus(`Load failed: ${String(e)}`))
      .finally(() => setLoading(false));
  }, [variantId]);

  // Hydrate form state from the loaded variant row.
  useEffect(() => {
    if (!variant) return;
    setLayoutPreset(variant.layout_preset ?? "fullscreen");
    setSubtitleStyleId(variant.subtitle_style_id ?? "impact-white");
    setCaptionStyleId(variant.caption_style_id ?? "white-pill-black");
    setCaptionText(variant.caption_text ?? "");
    const opts = (variant.layout_options ?? {}) as Record<string, unknown>;
    setFullscreenFit((opts.fullscreenFit as FullscreenFit) ?? "auto");
    setShowFrames(Boolean(opts.showFrames ?? true));
    setShowHitboxes(Boolean(opts.showHitboxes ?? false));
    setCaptionY((opts.captionY as number) ?? "");
    setSubtitleY((opts.subtitleY as number) ?? "");
    setCaptionSize((opts.captionSize as number) ?? "");
    setSubtitleSize((opts.subtitleSize as number) ?? "");
    setCaptionStartSec((opts.captionStartSec as number) ?? "");
    setCaptionEndSec((opts.captionEndSec as number) ?? "");
  }, [variant]);

  function buildLayoutOptions(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (layoutPreset === "fullscreen") out.fullscreenFit = fullscreenFit;
    if (layoutPreset === "zones") out.showFrames = showFrames;
    if (showHitboxes) out.showHitboxes = true;
    if (typeof captionY === "number") out.captionY = captionY;
    if (typeof subtitleY === "number") out.subtitleY = subtitleY;
    if (typeof captionSize === "number") out.captionSize = captionSize;
    if (typeof subtitleSize === "number") out.subtitleSize = subtitleSize;
    if (typeof captionStartSec === "number")
      out.captionStartSec = captionStartSec;
    if (typeof captionEndSec === "number") out.captionEndSec = captionEndSec;
    return out;
  }

  async function onSave() {
    if (!variantId) return;
    setSaving(true);
    setStatus("Saving + queuing re-render…");
    try {
      const r = await fetch(`/api/v1/clip-forge/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption_text: captionText,
          subtitle_style_id: subtitleStyleId,
          caption_style_id: captionStyleId,
          layout_preset: layoutPreset,
          layout_options: buildLayoutOptions(),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      setStatus("Saved. Re-render queued.");
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAsPreset() {
    if (!presetName.trim()) {
      setStatus("Preset name required.");
      return;
    }
    setSavingPreset(true);
    setStatus("Saving preset…");
    try {
      const r = await fetch(`/api/v1/clip-forge/style-presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName.trim(),
          subtitle_style_id: subtitleStyleId,
          caption_style_id: captionStyleId,
          layout_options: buildLayoutOptions(),
          caption_y: typeof captionY === "number" ? captionY : null,
          subtitle_y: typeof subtitleY === "number" ? subtitleY : null,
          caption_size: typeof captionSize === "number" ? captionSize : null,
          subtitle_size: typeof subtitleSize === "number" ? subtitleSize : null,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const data = (await r.json()) as { preset: StylePreset };
      setPresets((cur) => [data.preset, ...cur]);
      setPresetName("");
      setStatus(`Saved preset "${data.preset.name}".`);
    } catch (e) {
      setStatus(`Save preset failed: ${String(e)}`);
    } finally {
      setSavingPreset(false);
    }
  }

  function onLoadPreset(p: StylePreset) {
    if (p.subtitle_style_id) setSubtitleStyleId(p.subtitle_style_id);
    if (p.caption_style_id) setCaptionStyleId(p.caption_style_id);
    const opts = (p.layout_options ?? {}) as Record<string, unknown>;
    if (typeof opts.fullscreenFit === "string")
      setFullscreenFit(opts.fullscreenFit as FullscreenFit);
    if (typeof opts.showFrames === "boolean") setShowFrames(opts.showFrames);
    if (typeof opts.showHitboxes === "boolean")
      setShowHitboxes(opts.showHitboxes);
    setCaptionY(p.caption_y ?? "");
    setSubtitleY(p.subtitle_y ?? "");
    setCaptionSize(p.caption_size ?? "");
    setSubtitleSize(p.subtitle_size ?? "");
    setStatus(`Loaded preset "${p.name}".`);
  }

  const previewUrl = useMemo(() => {
    if (!variant?.rendered_mp4_key) return null;
    return `/api/media/${variant.rendered_mp4_key.replace(/\\\\/g, "/")}`;
  }, [variant?.rendered_mp4_key]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Header
        setScreen={setScreen}
        status={status}
        loading={loading || saving || savingPreset}
      />

      {!variantId && <EmptyVariantState />}

      {variantId && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            display: "grid",
            gridTemplateColumns: "1fr 380px",
          }}
        >
          <Preview
            previewUrl={previewUrl}
            overlayBoxes={extractOverlayBoxes(variant?.layout_options ?? null)}
          />

          <div
            style={{
              overflow: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              borderLeft: "1px solid #1d232a",
            }}
          >
            <Section title="LAYOUT">
              <Row label="preset">
                <Toggle2
                  value={layoutPreset}
                  options={[
                    ["fullscreen", "fullscreen"],
                    ["zones", "zones"],
                  ]}
                  onChange={(v) => setLayoutPreset(v as "fullscreen" | "zones")}
                />
              </Row>
              {layoutPreset === "fullscreen" && (
                <Row label="fit">
                  <Toggle3
                    value={fullscreenFit}
                    options={[
                      ["auto", "auto"],
                      ["cover", "cover"],
                      ["contain-center", "contain"],
                    ]}
                    onChange={(v) => setFullscreenFit(v as FullscreenFit)}
                  />
                </Row>
              )}
              {layoutPreset === "zones" && (
                <Row label="frames">
                  <ToggleBool value={showFrames} onChange={setShowFrames} />
                </Row>
              )}
              <Row label="hitboxes">
                <ToggleBool value={showHitboxes} onChange={setShowHitboxes} />
              </Row>
            </Section>

            <Section title="STYLE">
              <Row label="subtitle">
                <Select
                  value={subtitleStyleId}
                  options={SUBTITLE_OPTIONS}
                  onChange={setSubtitleStyleId}
                />
              </Row>
              <Row label="caption">
                <Select
                  value={captionStyleId}
                  options={CAPTION_OPTIONS}
                  onChange={setCaptionStyleId}
                />
              </Row>
            </Section>

            <Section title="POSITIONS (px, blank = preset default)">
              <NumberRow
                label="caption Y"
                value={captionY}
                setValue={setCaptionY}
                min={0}
                max={1920}
              />
              <NumberRow
                label="subtitle Y"
                value={subtitleY}
                setValue={setSubtitleY}
                min={0}
                max={1920}
              />
              <NumberRow
                label="caption size"
                value={captionSize}
                setValue={setCaptionSize}
                min={20}
                max={120}
              />
              <NumberRow
                label="subtitle size"
                value={subtitleSize}
                setValue={setSubtitleSize}
                min={30}
                max={140}
              />
            </Section>

            <Section title="CAPTION WINDOW (sec, blank = full clip)">
              <NumberRow
                label="start sec"
                value={captionStartSec}
                setValue={setCaptionStartSec}
                min={0}
                max={120}
                step={0.1}
              />
              <NumberRow
                label="end sec"
                value={captionEndSec}
                setValue={setCaptionEndSec}
                min={0}
                max={120}
                step={0.1}
              />
            </Section>

            <Section title="CAPTION TEXT">
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                rows={3}
                style={textAreaStyle}
              />
            </Section>

            <Section title="LOAD PRESET">
              {presets.length === 0 ? (
                <div style={mutedStyle}>no presets saved</div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onLoadPreset(p)}
                      style={presetButtonStyle}
                    >
                      <span style={{ fontSize: 12 }}>{p.name}</span>
                      <span style={mutedSmallStyle}>
                        {p.subtitle_style_id} · {p.caption_style_id}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section title="SAVE AS PRESET">
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="preset name"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={onSaveAsPreset}
                  disabled={savingPreset}
                  style={secondaryButtonStyle}
                >
                  save preset
                </button>
              </div>
            </Section>

            <div
              style={{
                marginTop: "auto",
                paddingTop: 12,
                borderTop: "1px solid #1d232a",
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={() => setScreen("inspector")}
                style={secondaryButtonStyle}
              >
                cancel
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                style={{ ...primaryButtonStyle, flex: 1 }}
              >
                {saving ? "saving…" : "save + re-render"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function Header(props: {
  setScreen: (s: ScreenId) => void;
  status: string;
  loading: boolean;
}) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid #1d232a",
        background: "#0b0e12",
      }}
    >
      <button
        onClick={() => props.setScreen("inspector")}
        style={secondaryButtonStyle}
      >
        ‹ inspector
      </button>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        Variant Recipe Studio
      </span>
      <span style={{ flex: 1 }} />
      {props.status && (
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: props.loading ? "#9aa1a9" : "#cfd4da",
          }}
        >
          {props.status}
        </span>
      )}
    </div>
  );
}

function EmptyVariantState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#7d8893",
        fontSize: 13,
      }}
    >
      Open a variant from the Inspector to edit it here.
    </div>
  );
}

interface OverlayBox {
  kind: "person" | "face";
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function extractOverlayBoxes(
  opts: Record<string, unknown> | null,
): OverlayBox[] {
  const raw = opts?.overlay_boxes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is OverlayBox =>
      !!b &&
      typeof b === "object" &&
      typeof (b as OverlayBox).x === "number" &&
      typeof (b as OverlayBox).y === "number" &&
      typeof (b as OverlayBox).w === "number" &&
      typeof (b as OverlayBox).h === "number" &&
      ((b as OverlayBox).kind === "person" ||
        (b as OverlayBox).kind === "face"),
  );
}

function Preview({
  previewUrl,
  overlayBoxes,
}: {
  previewUrl: string | null;
  overlayBoxes: OverlayBox[];
}) {
  const [showOverlay, setShowOverlay] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: 20,
        overflow: "auto",
      }}
    >
      {previewUrl ? (
        <div
          style={{
            position: "relative",
            width: 270,
            height: 480,
            borderRadius: 9,
            overflow: "hidden",
            border: "1px solid #2b333c",
            background: "#000",
          }}
        >
          <video
            key={previewUrl}
            src={previewUrl}
            controls
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#000",
            }}
          />
          {showOverlay && overlayBoxes.length > 0 && (
            <svg
              viewBox="0 0 1080 1920"
              preserveAspectRatio="xMidYMid meet"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {overlayBoxes.map((b, i) => {
                const color = b.kind === "face" ? "#39FF6A" : "#FFD400";
                return (
                  <g key={i}>
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      fill="none"
                      stroke={color}
                      strokeWidth={6}
                    />
                    <text
                      x={b.x + 6}
                      y={b.y - 8}
                      fill={color}
                      fontFamily="IBM Plex Mono, monospace"
                      fontSize={28}
                      fontWeight={700}
                    >
                      {b.kind.toUpperCase()} {b.label} {b.confidence.toFixed(2)}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      ) : (
        <div
          style={{
            width: 270,
            height: 480,
            borderRadius: 9,
            border: "1px solid #2b333c",
            background:
              "repeating-linear-gradient(135deg,#1c222b 0 8px,#161b22 8px 16px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: "#3a424b",
          }}
        >
          no rendered MP4 yet — save to render
        </div>
      )}
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: "#59616a",
        }}
      >
        1080 × 1920 · 9:16
      </span>
      {overlayBoxes.length > 0 && (
        <button
          onClick={() => setShowOverlay((v) => !v)}
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            padding: "5px 11px",
            borderRadius: 5,
            border: "1px solid #2b333c",
            background: showOverlay ? "#1a212a" : "transparent",
            color: showOverlay ? "#eef1f4" : "#aeb4bb",
            cursor: "pointer",
          }}
          title="Overlay person + face hitboxes on top of the rendered video"
        >
          hitboxes {showOverlay ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: ".12em",
          color: "#59616a",
          fontFamily: "'IBM Plex Mono', monospace",
          marginBottom: 9,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 90, fontSize: 11, color: "#9aa1a9" }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function NumberRow(props: {
  label: string;
  value: number | "";
  setValue: (n: number | "") => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Row label={props.label}>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => {
          const v = e.target.value;
          props.setValue(v === "" ? "" : Number(v));
        }}
        style={inputStyle}
      />
    </Row>
  );
}

function Select(props: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={inputStyle}
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Toggle2(props: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return <ToggleN {...props} />;
}
function Toggle3(props: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return <ToggleN {...props} />;
}
function ToggleN(props: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid #2b333c",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {props.options.map(([val, label], i) => {
        const active = props.value === val;
        return (
          <button
            key={val}
            onClick={() => props.onChange(val)}
            style={{
              flex: 1,
              border: 0,
              borderLeft: i > 0 ? "1px solid #2b333c" : 0,
              background: active ? "#1a212a" : "transparent",
              color: active ? "#eef1f4" : "#7d8893",
              padding: "5px 8px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
function ToggleBool(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleN
      value={props.value ? "on" : "off"}
      options={[
        ["off", "off"],
        ["on", "on"],
      ]}
      onChange={(v) => props.onChange(v === "on")}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#10141a",
  border: "1px solid #232a32",
  borderRadius: 5,
  color: "#e6e9ed",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "5px 9px",
  outline: "none",
};

const textAreaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.45,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid #2b333c",
  background: "transparent",
  color: "#aeb4bb",
  borderRadius: 5,
  padding: "5px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid #3f4954",
  background: "#1a212a",
  color: "#eef1f4",
  borderRadius: 5,
  padding: "7px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 500,
};

const presetButtonStyle: React.CSSProperties = {
  border: "1px solid #232a32",
  background: "#10141a",
  color: "#cfd4da",
  borderRadius: 5,
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const mutedStyle: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  color: "#59616a",
};
const mutedSmallStyle: React.CSSProperties = {
  ...mutedStyle,
  fontSize: 9.5,
};
