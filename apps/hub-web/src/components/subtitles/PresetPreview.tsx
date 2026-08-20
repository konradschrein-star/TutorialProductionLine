"use client";
// Compact per-card subtitle preview for the /subtitles library grid.
//
// For Remotion presets this runs the SAME real <CaptionOverlay> the render uses
// (via <CaptionPlayer>), so a card shows exactly how the style animates — the
// SubMagic-style animated preview. Players are lazy-mounted with an
// IntersectionObserver so only cards near the viewport actually run their
// composition loop (a grid of 20 presets doesn't spin up 20 rAF loops at once).
//
// The plan is shifted to start at frame 0 and the loop length is the exact
// caption span (loopDurationInFrames) — no leading pre-roll, no trailing tail —
// so the card never sits on a blank frame. Cards also get a deterministic
// initialFrame offset from their preset id so a grid never blinks in lockstep.
//
// FFmpeg presets use a different, static ASS config schema that CaptionOverlay
// cannot consume, so they get a FAITHFUL static frame (SVG at composition
// resolution: real font size, colors, outline, position, word count) instead of
// a fake "Subtitle preview" chip. A Remotion preset whose config FAILS to parse
// shows the parse error — it does not quietly pretend to be a working preview.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildCaptionPlan } from "@repo/media-core/subtitles/remotion";
import { RemotionConfigSchema, FfmpegConfigSchema } from "@repo/db/subtitles";
import { SAMPLE_PHRASE_MAP } from "./sample-phrases";
import { loopDurationInFrames, shiftPlanToStart } from "./preview-dimensions";
import { CaptionPlayer, PreviewError } from "./CaptionPlayer";

const FPS = 30;

type Engine = "remotion" | "ffmpeg";

/** Small deterministic hash of a string → non-negative integer. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// NOTE: this file used to carry an `FfmpegFrame` SVG that hand-approximated the
// libass look for `engine: "ffmpeg"` presets. It was a THIRD caption renderer
// with its own idea of size, colour and vertical placement, so the editor grid
// disagreed with both real engines. Both engines now consume one canonical
// config, so the preview below runs the real Remotion renderer for both — what
// the operator sees is what the pipeline draws (bar the documented libass
// differences listed in the preset editor).

export function PresetPreview({
  engine,
  config,
  aspect = "16:9",
  seed,
}: {
  engine: Engine;
  config: Record<string, unknown>;
  aspect?: "16:9" | "9:16";
  /** Preset id — de-synchronises the loop start across the grid. */
  seed?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Lazy-mount the real Player only when the card nears the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const dims = useMemo(
    () =>
      aspect === "9:16"
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 },
    [aspect],
  );

  // Cap the 9:16 card so a portrait grid doesn't become a wall of 600px boxes
  // (only two fit above the fold). maxWidth keeps the aspect while capping the
  // rendered height at ~340px. 16:9 fills the card width.
  const boxStyle: React.CSSProperties =
    aspect === "9:16"
      ? {
          width: "100%",
          maxWidth: 192,
          aspectRatio: "9 / 16",
          margin: "0 auto",
        }
      : { width: "100%", aspectRatio: "16 / 9" };

  // Build the caption plan for Remotion presets.
  //
  // The grid hands us the RAW jsonb straight off the API, so it is parsed here
  // rather than used as-is: the schema's `.default()`ed fields (maxWidthPercent,
  // sizeMode) are absent on rows written before those existed, and feeding
  // undefined into the layout math yields "NaN%" widths. A config that cannot
  // be parsed shows the parse error — it does not fake a working preview.
  const { plan, parsedConfig, error } = useMemo(() => {
    const schema =
      engine === "remotion" ? RemotionConfigSchema : FfmpegConfigSchema;
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        plan: null,
        parsedConfig: null,
        error: first
          ? `Invalid config: ${first.path.join(".") || "(root)"} — ${first.message}`
          : "Invalid config",
      };
    }
    try {
      // Pass the preview's own frame so the chunker wraps against the real
      // safe width. Without it the preview breaks lines differently from the
      // render at 9:16 — the same editor-vs-render mismatch the hand-rolled ASS
      // approximation used to cause.
      const built = buildCaptionPlan(
        SAMPLE_PHRASE_MAP.short.words,
        parsed.data,
        dims,
      );
      // Remove the leading pre-roll so the loop never opens on a blank frame.
      return {
        plan: shiftPlanToStart(built),
        parsedConfig: parsed.data,
        error: null as string | null,
      };
    } catch (e) {
      return {
        plan: null,
        parsedConfig: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [engine, config, dims]);

  const durationInFrames = useMemo(
    () => (plan && plan.length ? loopDurationInFrames(plan, FPS) : null),
    [plan],
  );

  const initialFrame = useMemo(() => {
    if (!durationInFrames || !seed) return 0;
    return hashString(seed) % durationInFrames;
  }, [durationInFrames, seed]);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        background: "linear-gradient(135deg,#26242e 0%,#141319 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        ...boxStyle,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {error ? (
          <PreviewError message={error} compact />
        ) : plan && parsedConfig && durationInFrames && visible ? (
          <CaptionPlayer
            plan={plan}
            config={parsedConfig}
            width={dims.width}
            height={dims.height}
            fps={FPS}
            durationInFrames={durationInFrames}
            initialFrame={initialFrame}
            compactError
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          // Pre-scroll placeholder only — replaced by the real player as soon
          // as the card enters the viewport.
          <span style={{ fontSize: 11, color: "#6f6a78" }}>…</span>
        )}
      </div>
    </div>
  );
}
