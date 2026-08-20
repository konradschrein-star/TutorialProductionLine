"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  PersonaChip,
  SectionLabel,
  StatusPill,
} from "../_components/atoms";
import type { CfClip, CfData, ScreenId } from "../_lib/types";

interface Props {
  data: CfData;
  clip: CfClip;
  setScreen: (s: ScreenId) => void;
  onEditVariant: (variantId: string) => void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  role?: string;
}
interface Hitbox {
  n_hits: number;
  face_box: Box | null;
  face_conf: number;
  person_box: Box | null;
  person_conf: number;
}
interface PortraitCrops {
  samples: number;
  confidence: number;
  detected_at: string;
  main_hitbox: Hitbox | null;
  facecam_hitbox: Hitbox | null;
  fullscreen_hitbox: Hitbox | null;
  // Crop boxes consumed by cf-render-variant.mjs. Inspector doesn't render
  // them today but the DB shape includes them, so keep the type aligned.
  main_headshot?: Box | null;
  main_portrait?: Box | null;
  facecam_headshot?: Box | null;
  facecam_portrait?: Box | null;
  fullscreen_headshot?: Box | null;
  fullscreen_portrait?: Box | null;
}
interface FacecamLayout {
  mode: string;
  boxes: Box[];
  frame_h: number;
  frame_w: number;
  manual_override: boolean;
}
interface WordTiming {
  w: string;
  t0: number;
  t1: number;
}
interface ClipDetailResponse {
  clip: {
    id: string;
    source_id: string;
    start_sec: number;
    end_sec: number;
    clip_score: number;
    score_reason: string;
    categories: string[];
    suggested_caption: string | null;
    raw_mp4_key: string | null;
    status: string;
    created_at: string;
  };
  source: {
    id: string;
    title: string;
    resolution: string | null;
    duration_sec: number;
    portrait_crops: PortraitCrops | null;
    facecam_layout: FacecamLayout | null;
    source_url: string;
  } | null;
  word_timings: WordTiming[];
}

interface VariantRow {
  id: string;
  raw_clip_id: string;
  variant_seed: number;
  platform: string;
  layout_preset: string | null;
  subtitle_style_id: string | null;
  caption_style_id: string | null;
  rendered_mp4_key: string | null;
  rendered_hash: string | null;
  /**
   * Real filesystem check from the API — true only when an MP4 actually
   * exists behind `rendered_mp4_key`. Undefined on responses from an older
   * deploy; treat undefined as "assume present" so the UI degrades to the
   * previous behaviour rather than declaring everything broken.
   */
  rendered_mp4_present?: boolean;
  rendered_mp4_size_bytes?: number | null;
  layout_options: Record<string, unknown> | null;
  caption_text: string | null;
  created_at: string;
}

interface PresetLite {
  id: string;
  name: string;
  persona_id: string | null;
  subtitle_style_id: string | null;
  caption_style_id: string | null;
  subtitle_style: Record<string, unknown> | null;
  caption_style: Record<string, unknown> | null;
  safe_zones: Record<string, { subtitle_y?: number; caption_y?: number }>;
  phrase_length_ms: number | null;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const COLORS = {
  face: "#cf7468",
  person: "#7fc79b",
  facecamFrame: "#cf9e68",
  mainFrame: "#454d57",
};

export function InspectorScreen({
  data,
  clip,
  setScreen,
  onEditVariant,
}: Props) {
  const dists = data.dists.filter((d) => d.clip === clip.id);

  const [detail, setDetail] = useState<ClipDetailResponse | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [presets, setPresets] = useState<PresetLite[]>([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [creating, setCreating] = useState(false);
  const [platform, setPlatform] = useState<
    "tiktok" | "instagram" | "youtube_shorts"
  >("tiktok");
  const [recentlyEnqueued, setRecentlyEnqueued] = useState<Set<string>>(
    new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  // Gate all in-flight fetch resolutions against unmount via a ref the effect
  // flips on cleanup. Without this, the 4s polling interval can still resolve
  // a fetch after the user leaves the inspector and call setVariants on an
  // unmounted component.
  const mountedRef = useRef(true);
  const rerenderTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const t of rerenderTimersRef.current) clearTimeout(t);
      rerenderTimersRef.current.clear();
    };
  }, []);

  const reloadVariants = useCallback(async () => {
    if (!clip.fullId) return;
    try {
      const r = await fetch(
        `/api/v1/clip-forge/raw-clips/${clip.fullId}/variants`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as { variants: VariantRow[] };
      if (mountedRef.current) setVariants(d.variants ?? []);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }, [clip.fullId]);

  useEffect(() => {
    if (!clip.fullId) return;
    let cancelled = false;
    fetch(`/api/v1/clip-forge/raw-clips/${clip.fullId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: ClipDetailResponse) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => !cancelled && setError(String(e)));
    reloadVariants();
    const id = setInterval(reloadVariants, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [clip.fullId, reloadVariants]);

  // Load saved presets once — used by the VariantCard preset picker to swap
  // a variant's full CaptionStyle without opening Studio.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/clip-forge/style-presets")
      .then((r) => r.json())
      .then((d: { presets?: PresetLite[] }) => {
        if (!cancelled) setPresets(d.presets ?? []);
      })
      .catch(() => {
        /* silent — presets are optional; card still works without them */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Apply a saved preset to a variant: merges the preset's CaptionStyle
   * objects + phrase length + layout-scoped safe zones into the variant's
   * layout_options, then PATCHes the variant (which enqueues a re-render). */
  async function applyPresetToVariant(variantId: string, presetId: string) {
    const p = presets.find((x) => x.id === presetId);
    const v = variants.find((x) => x.id === variantId);
    if (!p || !v) return;
    const opts = (v.layout_options ?? {}) as Record<string, unknown>;
    const layoutKind =
      typeof opts.layoutKind === "string" ? (opts.layoutKind as string) : null;
    const zone = layoutKind ? p.safe_zones?.[layoutKind] : null;
    const nextOpts: Record<string, unknown> = { ...opts };
    if (p.subtitle_style) nextOpts.subtitleStyle = p.subtitle_style;
    if (p.caption_style) nextOpts.captionStyle = p.caption_style;
    if (p.phrase_length_ms != null)
      nextOpts.phraseLengthMs = p.phrase_length_ms;
    if (zone?.subtitle_y != null) nextOpts.subtitleY = zone.subtitle_y;
    if (zone?.caption_y != null) nextOpts.captionY = zone.caption_y;

    setRecentlyEnqueued((prev) => new Set(prev).add(variantId));
    try {
      const r = await fetch(`/api/v1/clip-forge/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtitle_style_id: p.subtitle_style_id ?? undefined,
          caption_style_id: p.caption_style_id ?? undefined,
          layout_options: nextOpts,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      reloadVariants();
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      const timer = setTimeout(() => {
        rerenderTimersRef.current.delete(timer);
        if (!mountedRef.current) return;
        setRecentlyEnqueued((prev) => {
          const next = new Set(prev);
          next.delete(variantId);
          return next;
        });
      }, 3000);
      rerenderTimersRef.current.add(timer);
    }
  }

  async function makeNewVariant(preset: "fullscreen" | "zones") {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/clip-forge/raw-clips/${clip.fullId}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            layout_preset: preset,
            layout_options:
              preset === "fullscreen"
                ? { fullscreenFit: "auto" }
                : { showFrames: false },
          }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      reloadVariants();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function reRender(variantId: string) {
    setRecentlyEnqueued((prev) => new Set(prev).add(variantId));
    try {
      const r = await fetch(`/api/v1/clip-forge/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      const timer = setTimeout(() => {
        rerenderTimersRef.current.delete(timer);
        if (!mountedRef.current) return;
        setRecentlyEnqueued((prev) => {
          const next = new Set(prev);
          next.delete(variantId);
          return next;
        });
      }, 3000);
      rerenderTimersRef.current.add(timer);
    }
  }

  const scoreColor =
    clip.score >= 0.7 ? "#57a578" : clip.score >= 0.5 ? "#7b93d4" : "#b388c9";
  // Only variants with an MP4 actually on disk count as rendered. Counting
  // rows with a populated key reported "7 rendered" for a clip that could
  // not play a single one.
  const rendered = variants.filter(
    (v) => v.rendered_mp4_key && v.rendered_mp4_present !== false,
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
        <button onClick={() => setScreen("pool")} style={btn("ghost")}>
          ‹ pool
        </button>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            fontWeight: 600,
            color: "#eef1f4",
          }}
        >
          {clip.id}
        </span>
        <PersonaChip name={clip.persona} size={18} />
        <span style={{ fontSize: 11, color: "#9aa1a9" }}>{clip.persona}</span>
        <StatusPill status={clip.status} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10.5,
            color: "#7d8893",
          }}
        >
          {fmtTime(clip.tStart)} → {fmtTime(clip.tStart + clip.dur)} ·{" "}
          {clip.dur}s
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setShowOverlay((v) => !v)}
          style={btn(showOverlay ? "primary" : "ghost")}
          title="Toggle hitbox overlay on raw clip + every rendered variant"
        >
          detection {showOverlay ? "ON" : "OFF"}
        </button>
        <select
          value={platform}
          onChange={(e) =>
            setPlatform(
              e.target.value as "tiktok" | "instagram" | "youtube_shorts",
            )
          }
          style={{
            ...btn("ghost"),
            appearance: "auto",
          }}
          title="Platform tag applied to new variants"
        >
          <option value="tiktok">tiktok</option>
          <option value="instagram">instagram</option>
          <option value="youtube_shorts">shorts</option>
        </select>
        <button
          onClick={() => makeNewVariant("fullscreen")}
          style={btn("primary")}
        >
          + new fullscreen variant
        </button>
        <button onClick={() => makeNewVariant("zones")} style={btn("primary")}>
          + new zones variant
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "6px 16px",
            background: "rgba(207,116,104,.08)",
            color: "#cf7468",
            fontSize: 11,
            borderBottom: "1px solid #2b333c",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "14px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* LEFT — RAW CLIP (16:9, with optional overlay) + variants gallery */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
          }}
        >
          <Card pad={12}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <SectionLabel>
                RAW CLIP · SOURCE ASPECT · NO CAPTIONS
              </SectionLabel>
              <span style={{ flex: 1 }} />
              {detail?.source?.portrait_crops && <DetectionLegend />}
            </div>
            <RawClipWithOverlay
              clipKey={detail?.clip.raw_mp4_key ?? null}
              source={detail?.source ?? null}
              showOverlay={showOverlay}
            />
            {detail?.source?.portrait_crops && (
              <DetectionSummary
                portraitCrops={detail.source.portrait_crops}
                facecamLayout={detail.source.facecam_layout}
              />
            )}
          </Card>

          <Card pad={0} style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #1d232a",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Finishing Variants
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#7d8893",
                }}
              >
                {variants.length} total · {rendered} rendered
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: "#59616a" }}>
                each is a finished 9:16 reframe of the raw clip above
              </span>
            </div>
            {variants.length === 0 ? (
              <div
                style={{
                  padding: "32px 14px",
                  textAlign: "center",
                  color: "#7d8893",
                  fontSize: 11.5,
                }}
              >
                No variants yet. Click &quot;+ new fullscreen variant&quot; or
                &quot;+ new zones variant&quot; in the header to spin one up.
              </div>
            ) : (
              <div
                style={{
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
                  gap: 10,
                }}
              >
                {variants.map((v) => (
                  <VariantCard
                    key={v.id}
                    variant={v}
                    presets={presets}
                    rerendering={recentlyEnqueued.has(v.id)}
                    showOverlay={showOverlay}
                    onEdit={() => onEditVariant(v.id)}
                    onReRender={() => reRender(v.id)}
                    onApplyPreset={(pid) => applyPresetToVariant(v.id, pid)}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT — score / transcript / distributions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card pad={14}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: ".1em",
                    color: "#59616a",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  SCORE
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 28,
                    fontWeight: 600,
                    color: scoreColor,
                  }}
                >
                  {clip.score.toFixed(2)}
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: "#171c22",
                  overflow: "hidden",
                  marginTop: 14,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(clip.score * 100).toFixed(0)}%`,
                    background: scoreColor,
                  }}
                />
              </div>
            </div>
            <SectionLabel>CLASSIFIER REASONING</SectionLabel>
            <p
              style={{
                fontSize: 13,
                color: "#cfd4da",
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              {clip.reason || detail?.clip.score_reason || "—"}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {clip.cats.map((cat) => (
                <span
                  key={cat}
                  style={{
                    fontSize: 10.5,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: "#cfd4da",
                    border: "1px solid #2b333c",
                    borderRadius: 4,
                    padding: "2px 7px",
                  }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </Card>

          <Card pad={14}>
            <SectionLabel>TRANSCRIPT · WORD-TIMED</SectionLabel>
            <Transcript
              words={detail?.word_timings ?? []}
              clipStart={clip.tStart}
            />
          </Card>

          <Card pad={0} style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 14px",
                borderBottom: "1px solid #1d232a",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                Distributions
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#7d8893",
                }}
              >
                {dists.length} accounts
              </span>
            </div>
            {dists.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  textAlign: "center",
                  color: "#7d8893",
                  fontSize: 11,
                }}
              >
                Not yet distributed.
                <br />
                {/* There is no push-to-platform action in Clip Forge — no
                    upload endpoint exists. Download the variant and post it
                    manually until the uploader lands. */}
                Download a rendered variant (↓) and post it manually.
              </div>
            ) : (
              dists.map((d) => (
                <div
                  key={d.id}
                  style={{
                    padding: "9px 14px",
                    borderBottom: "1px solid #14181d",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: "#cfd4da",
                        flex: 1,
                      }}
                    >
                      {d.handle}
                    </span>
                    <StatusPill status={d.status} />
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      color: "#6b727b",
                    }}
                  >
                    {d.platform} · {d.up || d.sched}
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * The raw clip <video> with an SVG detection overlay layered on top. The SVG
 * uses viewBox=`0 0 frame_w frame_h` so we plot face/person/facecam boxes in
 * source-frame coordinates.
 *
 * The video uses `objectFit: contain`, which letterboxes when its intrinsic
 * aspect differs from the container's. The SVG must letterbox the same way
 * or its rectangles drift off the visible video pixels — so we use the
 * default `xMidYMid meet` preserveAspectRatio (rather than `none`) and the
 * overlay tracks the video exactly, including legacy 9:16-blur-bar clips.
 */
function RawClipWithOverlay({
  clipKey,
  source,
  showOverlay,
}: {
  clipKey: string | null;
  source: ClipDetailResponse["source"];
  showOverlay: boolean;
}) {
  const parsed = parseResolution(source?.resolution ?? null);
  // `??` doesn't catch numeric 0 — if the detector ever writes a zero-valued
  // default for frame_w/h, the container would collapse to `aspect-ratio: 0/0`
  // (invalid CSS). pickPositive falls through to the next candidate on 0/NaN.
  const frameW = pickPositive(source?.facecam_layout?.frame_w, parsed.w, 1920);
  const frameH = pickPositive(source?.facecam_layout?.frame_h, parsed.h, 1080);

  if (!clipKey) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: `${frameW}/${frameH}`,
          background:
            "repeating-linear-gradient(135deg,#171c23 0 6px,#12161c 6px 12px)",
          border: "1px solid #232a32",
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7d8893",
          fontSize: 11,
        }}
      >
        raw clip not extracted yet
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${frameW}/${frameH}`,
        background: "#000",
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      <video
        src={`/api/media/${clipKey}`}
        controls
        preload="metadata"
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
        }}
      />
      {showOverlay && (source?.portrait_crops || source?.facecam_layout) && (
        <svg
          viewBox={`0 0 ${frameW} ${frameH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            width: "100%",
            height: "100%",
          }}
        >
          <DetectionMarkers
            portraitCrops={source?.portrait_crops ?? null}
            facecamLayout={source?.facecam_layout ?? null}
          />
        </svg>
      )}
    </div>
  );
}

/**
 * Draws face/person hitboxes for both the main view and the facecam region,
 * with markers connecting face → person inside each. Facecam-local coords are
 * offset back into the source frame so everything renders in one canvas.
 */
function DetectionMarkers({
  portraitCrops,
  facecamLayout,
}: {
  portraitCrops: PortraitCrops | null;
  facecamLayout: FacecamLayout | null;
}) {
  const mainBox = facecamLayout?.boxes.find((b) => b.role === "main");
  const facecamBox = facecamLayout?.boxes.find((b) => b.role === "facecam");
  const mainOff = { x: 0, y: 0 };
  const facecamOff = facecamBox
    ? { x: facecamBox.x, y: facecamBox.y }
    : { x: 0, y: 0 };

  return (
    <g>
      {mainBox && (
        <FrameOutline box={mainBox} color={COLORS.mainFrame} label="MAIN" />
      )}
      {facecamBox && (
        <FrameOutline
          box={facecamBox}
          color={COLORS.facecamFrame}
          label="FACECAM"
        />
      )}
      {portraitCrops?.main_hitbox?.person_box && (
        <PersonFaceMarker
          person={shift(portraitCrops.main_hitbox.person_box, mainOff)}
          face={
            portraitCrops.main_hitbox.face_box
              ? shift(portraitCrops.main_hitbox.face_box, mainOff)
              : null
          }
          personConf={portraitCrops.main_hitbox.person_conf}
          faceConf={portraitCrops.main_hitbox.face_conf}
        />
      )}
      {portraitCrops?.facecam_hitbox?.person_box && (
        <PersonFaceMarker
          person={shift(portraitCrops.facecam_hitbox.person_box, facecamOff)}
          face={
            portraitCrops.facecam_hitbox.face_box
              ? shift(portraitCrops.facecam_hitbox.face_box, facecamOff)
              : null
          }
          personConf={portraitCrops.facecam_hitbox.person_conf}
          faceConf={portraitCrops.facecam_hitbox.face_conf}
        />
      )}
    </g>
  );
}

function shift(b: Box, off: { x: number; y: number }): Box {
  return { ...b, x: b.x + off.x, y: b.y + off.y };
}

function FrameOutline({
  box,
  color,
  label,
}: {
  box: Box;
  color: string;
  label: string;
}) {
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeDasharray="10 6"
      />
      <text
        x={box.x + 10}
        y={box.y + 28}
        fontFamily="IBM Plex Mono, monospace"
        fontSize={18}
        fill={color}
        fontWeight={700}
      >
        {label}
      </text>
    </g>
  );
}

function PersonFaceMarker({
  person,
  face,
  personConf,
  faceConf,
}: {
  person: Box;
  face: Box | null;
  personConf: number;
  faceConf: number;
}) {
  const personCx = person.x + person.w / 2;
  const personCy = person.y + person.h / 2;
  return (
    <g>
      <rect
        x={person.x}
        y={person.y}
        width={person.w}
        height={person.h}
        fill="none"
        stroke={COLORS.person}
        strokeWidth={3}
      />
      <text
        x={person.x + 8}
        y={person.y + 26}
        fontFamily="IBM Plex Mono, monospace"
        fontSize={16}
        fill={COLORS.person}
        fontWeight={600}
      >
        person {(personConf * 100).toFixed(0)}%
      </text>
      {face && (
        <>
          <rect
            x={face.x}
            y={face.y}
            width={face.w}
            height={face.h}
            fill="none"
            stroke={COLORS.face}
            strokeWidth={3}
          />
          <text
            x={face.x + 6}
            y={face.y - 6}
            fontFamily="IBM Plex Mono, monospace"
            fontSize={16}
            fill={COLORS.face}
            fontWeight={600}
          >
            face {(faceConf * 100).toFixed(0)}%
          </text>
          <line
            x1={personCx}
            y1={personCy}
            x2={face.x + face.w / 2}
            y2={face.y + face.h / 2}
            stroke={COLORS.face}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            opacity={0.6}
          />
        </>
      )}
    </g>
  );
}

function DetectionLegend() {
  const items = [
    ["person", COLORS.person],
    ["face", COLORS.face],
    ["main region", COLORS.mainFrame],
    ["facecam region", COLORS.facecamFrame],
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 9.5,
        fontFamily: "'IBM Plex Mono', monospace",
        color: "#9aa1a9",
      }}
    >
      {items.map(([name, color]) => (
        <span
          key={name}
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: color,
              display: "inline-block",
            }}
          />
          {name}
        </span>
      ))}
    </div>
  );
}

function DetectionSummary({
  portraitCrops,
  facecamLayout,
}: {
  portraitCrops: PortraitCrops;
  facecamLayout: FacecamLayout | null;
}) {
  const main = portraitCrops.main_hitbox;
  const facecam = portraitCrops.facecam_hitbox;
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 10px",
        background: "#10141a",
        border: "1px solid #1d232a",
        borderRadius: 4,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10.5,
        color: "#aeb4bb",
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "#59616a" }}>detection:</span>
      {facecamLayout && <span>layout · {facecamLayout.mode}</span>}
      {main && (
        <span>
          main · 1 person ({(main.person_conf * 100).toFixed(0)}%) ·{" "}
          {main.face_box
            ? `face ${(main.face_conf * 100).toFixed(0)}%`
            : "no face"}
        </span>
      )}
      {facecam && (
        <span>
          facecam · 1 person ({(facecam.person_conf * 100).toFixed(0)}%) ·{" "}
          {facecam.face_box
            ? `face ${(facecam.face_conf * 100).toFixed(0)}%`
            : "no face"}
        </span>
      )}
    </div>
  );
}

function Transcript({
  words,
  clipStart,
}: {
  words: WordTiming[];
  clipStart: number;
}) {
  if (words.length === 0) {
    return (
      <div style={{ color: "#7d8893", fontSize: 11.5 }}>
        No word-timed transcript available.
      </div>
    );
  }
  const lines: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  let curStart = words[0].t0;
  for (const w of words) {
    if (w.t0 - curStart > 3.5 && cur.length > 0) {
      lines.push(cur);
      cur = [];
      curStart = w.t0;
    }
    cur.push(w);
  }
  if (cur.length > 0) lines.push(cur);
  return (
    <div>
      {lines.map((line, i) => {
        const t0 = line[0].t0 - clipStart;
        return (
          <div key={i} style={{ display: "flex", gap: 12, padding: "3px 0" }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: "#59616a",
                flex: "0 0 42px",
              }}
            >
              {t0 >= 0 ? `+${t0.toFixed(1)}` : t0.toFixed(1)}
            </span>
            <span style={{ fontSize: 12.5, color: "#aeb4bb" }}>
              {line.map((w) => w.w).join(" ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VariantCard({
  variant,
  presets,
  rerendering,
  showOverlay,
  onEdit,
  onReRender,
  onApplyPreset,
}: {
  variant: VariantRow;
  presets: PresetLite[];
  rerendering: boolean;
  showOverlay: boolean;
  onEdit: () => void;
  onReRender: () => void;
  onApplyPreset: (presetId: string) => void;
}) {
  // `rendered_mp4_present` is a filesystem check from the API. A populated
  // key with no file behind it means the artifact was deleted — show that
  // explicitly instead of mounting a <video> that 404s.
  const hasKey = !!variant.rendered_mp4_key;
  const rendered = hasKey && variant.rendered_mp4_present !== false;
  const artifactMissing = hasKey && variant.rendered_mp4_present === false;
  const mediaUrl = variant.rendered_mp4_key
    ? `/api/media/${variant.rendered_mp4_key.replace(/\\/g, "/")}`
    : null;
  const overlayBoxes = extractOverlayBoxes(variant.layout_options);
  return (
    <div
      style={{
        border: "1px solid #1d232a",
        borderRadius: 6,
        overflow: "hidden",
        background: "#10141a",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9/16",
          background: "#000",
        }}
        onClick={onEdit}
      >
        {rendered && mediaUrl ? (
          <video
            src={mediaUrl}
            preload="metadata"
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              void (e.currentTarget as HTMLVideoElement).play().catch(() => {})
            }
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundImage:
                "repeating-linear-gradient(135deg,#1a1f26 0 4px,#141920 4px 8px)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 8,
              color: artifactMissing ? "#dd8d83" : "#7d8893",
              fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {rerendering
              ? "rendering…"
              : artifactMissing
                ? "MP4 MISSING"
                : "not rendered"}
            {artifactMissing && !rerendering && (
              <span style={{ fontSize: 9, color: "#9aa1a9" }}>
                file deleted — press ↻
              </span>
            )}
          </div>
        )}
        {rendered && showOverlay && overlayBoxes.length > 0 && (
          <VariantOverlay boxes={overlayBoxes} />
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#eef1f4",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            seed {variant.variant_seed}
          </span>
          <span style={{ fontSize: 9.5, color: "#7d8893" }}>
            {variant.layout_preset ?? "—"}
          </span>
          <span style={{ flex: 1 }} />
          {rendered ? (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: "#7fc79b",
              }}
              title={variant.rendered_hash ?? ""}
            >
              ✓
            </span>
          ) : (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9,
                color: "#cf9e68",
              }}
            >
              {rerendering ? "↻" : "·"}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9.5,
            color: "#9aa1a9",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`${variant.subtitle_style_id ?? "—"} · ${variant.caption_style_id ?? "—"}`}
        >
          {variant.subtitle_style_id ?? "—"}
          <br />
          {variant.caption_style_id ?? "—"}
        </div>
        {presets.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onApplyPreset(e.target.value);
              e.currentTarget.value = "";
            }}
            title="Apply a saved preset — swaps subtitle_style + caption_style + phrase length in one shot, then re-renders."
            style={{
              width: "100%",
              marginTop: 7,
              background: "#0f141a",
              color: "#cfd4da",
              border: "1px solid #2b333c",
              borderRadius: 5,
              padding: "4px 6px",
              fontSize: 10.5,
              fontFamily: "'IBM Plex Mono', monospace",
              cursor: "pointer",
            }}
          >
            <option value="">apply preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
          <button onClick={onEdit} style={{ ...btn("primary"), flex: 1 }}>
            edit
          </button>
          {/* Getting the MP4 off the box is the last step of actually
              producing a clip. Before this there was no way to do it from
              the console at all. */}
          {rendered && mediaUrl && (
            <a
              href={mediaUrl}
              download={`${variant.raw_clip_id ?? "clip"}__seed${variant.variant_seed}.mp4`}
              onClick={(e) => e.stopPropagation()}
              title="Download this variant's MP4"
              style={{
                ...btn("ghost"),
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              ↓
            </a>
          )}
          <button
            onClick={onReRender}
            disabled={rerendering}
            title={
              artifactMissing
                ? "Re-render — the MP4 for this variant is missing"
                : "Re-render this variant"
            }
            style={btn(artifactMissing ? "primary" : "ghost")}
          >
            ↻
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Detection-overlay SVG layered on top of a rendered 9:16 variant video.
 * Coordinates come pre-baked from the worker at variant-generation time
 * (`layout_options.overlay_boxes`) in 1080x1920 output space, so we plot them
 * directly into a matching viewBox and they align with the video pixels.
 */
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

function VariantOverlay({ boxes }: { boxes: OverlayBox[] }) {
  return (
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
      {boxes.map((b, i) => {
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
  );
}

function parseResolution(res: string | null): {
  w: number | null;
  h: number | null;
} {
  if (!res) return { w: null, h: null };
  // Handles "1920×1080" (U+00D7) and "1920x1080" (ASCII).
  const m = res.match(/(\d{2,5})\s*[×x]\s*(\d{2,5})/);
  if (!m) return { w: null, h: null };
  return { w: Number(m[1]), h: Number(m[2]) };
}

function pickPositive(...values: Array<number | null | undefined>): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 1; // unreachable in practice — last fallback is always a literal.
}

function btn(kind: "ghost" | "primary", disabled = false): React.CSSProperties {
  if (kind === "primary") {
    return {
      border: "1px solid #3f4954",
      background: disabled ? "#10141a" : "#1a212a",
      color: disabled ? "#7d8893" : "#eef1f4",
      borderRadius: 5,
      padding: "5px 11px",
      cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      fontWeight: 500,
    };
  }
  return {
    border: "1px solid #2b333c",
    background: "transparent",
    color: "#aeb4bb",
    borderRadius: 5,
    padding: "5px 11px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
  };
}
