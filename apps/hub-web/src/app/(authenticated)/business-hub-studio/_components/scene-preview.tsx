"use client";

/**
 * Scene Preview — pick a layout, pick a pose, see the composed frame.
 *
 * WHAT THIS IS AND IS NOT. This is a geometry preview, not the renderer. The
 * shipped frame is produced by FFmpeg plus the Remotion compositions in
 * `apps/worker-render/src/remotion/business-hub/` (tasks M1–M5), which hub-web
 * cannot import. What this panel renders is the part of the composition the
 * Presenter Studio actually owns and can be authoritative about:
 *
 *  - where the figure lands, at what apparent size, derived from the pose's own
 *    `collar` hitbox through the same formula the compositor uses;
 *  - where the head mark sits, from the `head` hitbox;
 *  - which way `framed-chart` rotates its object, from `pointDirection`;
 *  - whether the object layer stays inside `safeRegion` and clear of the figure;
 *  - that the watermark's corner is not colliding with anything.
 *
 * Everything else — real charts, real props, grades, motion — is a block whose
 * size and placement are honest but whose contents are not the real element. The
 * point is to tune layout geometry without paying for a full video render, which
 * is what design §6.2 asks of this surface.
 *
 * FAIL-CLOSED: a layout that needs a presenter will not draw one from a pose
 * with no `collar` or `head`. It says which hitbox is missing instead of placing
 * the figure at an assumed scale.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HeadHitbox,
  Layout,
  NormRect,
  NormVector,
  Pose,
} from "@repo/contracts";

import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import { directionAngleDeg, poseScaleForCollar } from "../_lib/geometry";
import { HeadMark } from "../_lib/head-mark";
import { Watermark } from "../_lib/watermark";
import { FORMAT, UI } from "../_lib/palette";
import { poseImageUrl } from "../_lib/api";

/** Calibration currently in force for one pose (draft if edited, saved otherwise). */
export interface ScenePoseCalibration {
  pose: Pose;
  collarWidth: number | null;
  head: HeadHitbox | null;
  pointOrigin: { x: number; y: number } | null;
  pointDirection: NormVector | null;
  safeRegion: NormRect | null;
}

interface Props {
  entries: ScenePoseCalibration[];
  focusSlug: string | null;
}

/** Output frame from the template's render settings (brief §3.5). */
const FRAME_W = 1920;
const FRAME_H = 1080;

/** The nine layouts of the format's visual vocabulary (contracts `LayoutSchema`). */
const LAYOUTS: Layout[] = [
  "clipping",
  "framed-chart",
  "paper-stack",
  "card-grid",
  "timeline-walk",
  "projection-room",
  "broll-defocus",
  "studio-set",
  "presenter-solo",
];

/** How each layout uses the presenter, per design §3.2's table. */
const PRESENTER_USE: Record<
  Layout,
  { required: boolean; side: "left" | "right" | "center"; collarPx: number }
> = {
  clipping: { required: false, side: "right", collarPx: 150 },
  "framed-chart": { required: false, side: "right", collarPx: 150 },
  "paper-stack": { required: false, side: "right", collarPx: 140 },
  "card-grid": { required: true, side: "right", collarPx: 150 },
  "timeline-walk": { required: true, side: "center", collarPx: 110 },
  "projection-room": { required: true, side: "left", collarPx: 160 },
  "broll-defocus": { required: true, side: "center", collarPx: 240 },
  "studio-set": { required: true, side: "left", collarPx: 200 },
  "presenter-solo": { required: true, side: "center", collarPx: 300 },
};

const LAYOUT_NOTE: Record<Layout, string> = {
  clipping: "Torn headline strip, rotated. Mat bare or propped.",
  "framed-chart":
    "Wooden frame over a second frame. The frame's rotation follows the pointing vector — it is the composition rule, not decoration.",
  "paper-stack": "Two or three offset sheets; the top one carries the chart.",
  "card-grid": "N image cards in a grid; the presenter gestures at one.",
  "timeline-walk":
    "Horizontal axis with year ticks. The figure is placed AT a data coordinate — he is a mark on the axis.",
  "projection-room": "Rendered room, framed projection screen, motion blur.",
  "broll-defocus":
    "Blurred footage ground, no object layer, presenter centred and large.",
  "studio-set":
    "Office set with desk and microphone in the foreground; seated.",
  "presenter-solo":
    "Mat, no objects, figure large and cropped by the frame edge.",
};

export function ScenePreview({ entries, focusSlug }: Props) {
  const [layout, setLayout] = useState<Layout>("framed-chart");
  const [ground, setGround] = useState<"dark" | "light">("dark");
  const [poseSlug, setPoseSlug] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((es) => {
      const entry = es[0];
      if (entry) setStageWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPoseSlug((current) => {
      if (current && entries.some((e) => e.pose.slug === current))
        return current;
      if (focusSlug && entries.some((e) => e.pose.slug === focusSlug))
        return focusSlug;
      return entries[0]?.pose.slug ?? null;
    });
  }, [entries, focusSlug]);

  const entry = useMemo(
    () => entries.find((e) => e.pose.slug === poseSlug) ?? null,
    [entries, poseSlug],
  );

  const use = PRESENTER_USE[layout];
  const scale = stageWidth > 0 ? stageWidth / FRAME_W : 0;
  const stageHeight = stageWidth * (FRAME_H / FRAME_W);
  const groundColour =
    ground === "dark" ? FORMAT.groundDark : FORMAT.groundLight;
  const inkColour = ground === "dark" ? FORMAT.mist : FORMAT.ink;

  const blockers: string[] = [];
  if (!entry) {
    blockers.push("No pose selected.");
  } else {
    if (entry.collarWidth === null) {
      blockers.push(
        `Pose "${entry.pose.slug}" has no collar hitbox, so its apparent size cannot be normalised. ` +
          "Nothing is drawn at an assumed scale.",
      );
    }
    if (entry.head === null) {
      blockers.push(
        `Pose "${entry.pose.slug}" has no head hitbox, so the mark has nowhere to sit.`,
      );
    }
    if (layout === "framed-chart" && entry.pointDirection === null) {
      blockers.push(
        "framed-chart rotates its frame by the pose's pointDirection, which is not authored yet.",
      );
    }
  }
  const canDrawPresenter = entry !== null && blockers.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <V2Listbox
            label="Layout"
            value={layout}
            onChange={(value) => setLayout(asLayout(value))}
            options={LAYOUTS.map((l) => ({ value: l, label: l }))}
          />
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <V2Listbox
            label="Pose"
            value={poseSlug ?? ""}
            onChange={setPoseSlug}
            options={entries.map((e) => ({
              value: e.pose.slug,
              label: e.pose.slug,
              hint:
                e.collarWidth === null
                  ? "no collar hitbox"
                  : "calibrated collar",
            }))}
          />
        </div>
        <div style={{ minWidth: 180, flex: 1 }}>
          <V2Listbox
            label="Ground"
            value={ground}
            onChange={(value) =>
              setGround(value === "light" ? "light" : "dark")
            }
            options={[
              { value: "dark", label: "Default — near-black mat" },
              { value: "light", label: "Inverse — near-white mat" },
            ]}
          />
        </div>
      </div>

      <div
        ref={stageRef}
        style={{
          position: "relative",
          width: "100%",
          height: stageHeight || 320,
          borderRadius: 12,
          overflow: "hidden",
          background: groundColour,
          border: `1px solid ${UI.hairline}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${gridLine(ground)} 1px, transparent 1px), linear-gradient(90deg, ${gridLine(ground)} 1px, transparent 1px)`,
            backgroundSize: `${48 * (scale || 1)}px ${48 * (scale || 1)}px`,
          }}
        />

        {scale > 0 && (
          <ObjectLayer
            layout={layout}
            scale={scale}
            ink={inkColour}
            ground={ground}
            pointDirection={entry?.pointDirection ?? null}
          />
        )}

        {scale > 0 && canDrawPresenter && entry && (
          <Figure
            entry={entry}
            side={use.side}
            collarPx={use.collarPx}
            scale={scale}
            stageHeight={stageHeight}
            ground={ground}
            showSafeRegion
          />
        )}

        {scale > 0 && (
          <div
            style={{
              position: "absolute",
              right: 48 * scale,
              bottom: 40 * scale,
            }}
          >
            <Watermark
              widthPx={Math.max(12, 132 * scale)}
              colour={ground === "dark" ? "#ffffff" : FORMAT.ink}
            />
          </div>
        )}
      </div>

      {blockers.length > 0 && (
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,180,171,0.08)",
            border: "1px solid rgba(255,180,171,0.25)",
            fontSize: 11,
            color: "#ffb4ab",
            lineHeight: 1.6,
          }}
        >
          {blockers.map((b) => (
            <div key={b}>{b}</div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: UI.text2, lineHeight: 1.6 }}>
        <strong style={{ color: UI.text1 }}>{layout}</strong> —{" "}
        {LAYOUT_NOTE[layout]} Presenter {use.required ? "required" : "optional"}
        , side {use.side}, collar {use.collarPx}px of {FRAME_W}. Object blocks
        are placeholders for the Remotion elements; their geometry is real,
        their contents are not.
      </div>
    </div>
  );
}

/**
 * The object layer for one layout.
 *
 * Nothing here is axis-aligned (design §3.2): every block carries a few degrees
 * of rotation and a drop shadow, because that is what makes the set read as
 * produced rather than assembled. `framed-chart` takes its rotation from the
 * pose's pointing vector rather than a constant.
 */
function ObjectLayer({
  layout,
  scale,
  ink,
  ground,
  pointDirection,
}: {
  layout: Layout;
  scale: number;
  ink: string;
  ground: "dark" | "light";
  pointDirection: NormVector | null;
}) {
  const surface =
    ground === "dark" ? "rgba(73,118,159,0.30)" : "rgba(10,65,116,0.14)";
  const edge = ground === "dark" ? FORMAT.steel : FORMAT.navy;
  const shadow =
    ground === "dark"
      ? "0 18px 44px rgba(0,0,0,0.55)"
      : "0 18px 40px rgba(0,29,57,0.22)";

  const block = (
    x: number,
    y: number,
    w: number,
    h: number,
    rotateDeg: number,
    label: string,
    fill = surface,
  ) => (
    <div
      key={`${label}-${x}-${y}`}
      style={{
        position: "absolute",
        left: x * scale,
        top: y * scale,
        width: w * scale,
        height: h * scale,
        background: fill,
        border: `${Math.max(1, 2 * scale)}px solid ${edge}`,
        borderRadius: 4 * scale,
        boxShadow: shadow,
        transform: `rotate(${rotateDeg}deg)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: ink,
        fontSize: Math.max(9, 22 * scale),
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );

  switch (layout) {
    case "clipping":
      return <>{block(160, 300, 900, 260, -2.4, "headline strip")}</>;
    case "framed-chart": {
      // Design §3.2: "the frame's rotation follows the pointing vector".
      // Scaled down from the raw angle so the frame tilts a few degrees rather
      // than standing on its corner.
      const raw =
        pointDirection === null ? -3 : directionAngleDeg(pointDirection) * 0.12;
      const rotation = Math.max(-8, Math.min(8, raw));
      return (
        <>
          {block(150, 210, 880, 560, rotation + 3.2, "frame behind")}
          {block(190, 180, 880, 560, rotation, "chart")}
        </>
      );
    }
    case "paper-stack":
      return (
        <>
          {block(200, 260, 820, 540, 3.6, "sheet 3")}
          {block(180, 236, 820, 540, -1.8, "sheet 2")}
          {block(160, 212, 820, 540, 1.1, "chart sheet")}
        </>
      );
    case "card-grid":
      return (
        <>
          {block(140, 220, 380, 240, -1.6, "card 1")}
          {block(560, 200, 380, 240, 2.1, "card 2")}
          {block(140, 500, 380, 240, 1.4, "card 3")}
          {block(560, 480, 380, 240, -2.2, "card 4")}
        </>
      );
    case "timeline-walk":
      return (
        <>
          <div
            style={{
              position: "absolute",
              left: 120 * scale,
              top: 760 * scale,
              width: 1680 * scale,
              height: Math.max(1, 3 * scale),
              background: edge,
            }}
          />
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: (200 + i * 380) * scale,
                top: 744 * scale,
                width: Math.max(1, 3 * scale),
                height: 34 * scale,
                background: edge,
              }}
            />
          ))}
        </>
      );
    case "projection-room":
      return <>{block(760, 150, 1000, 620, -1.2, "projection screen")}</>;
    case "broll-defocus":
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              ground === "dark"
                ? "radial-gradient(circle at 50% 45%, rgba(73,118,159,0.34), rgba(11,15,20,0.9))"
                : "radial-gradient(circle at 50% 45%, rgba(189,216,233,0.9), rgba(242,241,236,0.95))",
            filter: "blur(2px)",
          }}
        />
      );
    case "studio-set":
      return (
        <>
          {block(0, 820, 1920, 260, 0, "desk edge", surface)}
          {block(1180, 640, 120, 300, -6, "microphone")}
        </>
      );
    case "presenter-solo":
      return null;
    default: {
      const exhaustive: never = layout;
      throw new Error(
        `[ScenePreview] unhandled layout "${String(exhaustive)}"`,
      );
    }
  }
}

function Figure({
  entry,
  side,
  collarPx,
  scale,
  stageHeight,
  ground,
  showSafeRegion,
}: {
  entry: ScenePoseCalibration;
  side: "left" | "right" | "center";
  collarPx: number;
  scale: number;
  stageHeight: number;
  ground: "dark" | "light";
  showSafeRegion: boolean;
}) {
  const collarWidth = entry.collarWidth;
  const head = entry.head;
  if (collarWidth === null || head === null) {
    throw new Error(
      `[ScenePreview] Figure was rendered for pose "${entry.pose.slug}" without a collar or ` +
        "head hitbox. The caller must gate on that; reaching here is a bug.",
    );
  }

  const [poseW, poseH] = entry.pose.size;
  const { widthPx, heightPx } = poseScaleForCollar({
    poseWidthPx: poseW,
    poseHeightPx: poseH,
    collarWidthNorm: collarWidth,
    targetCollarPx: collarPx,
  });

  const displayW = widthPx * scale;
  const displayH = heightPx * scale;
  const top = stageHeight - displayH;

  const left =
    side === "left"
      ? FRAME_W * 0.06 * scale
      : side === "center"
        ? (FRAME_W * scale - displayW) / 2
        : undefined;
  const right = side === "right" ? FRAME_W * 0.06 * scale : undefined;

  const headDiameter = head.radius * displayW * 2;

  return (
    <div
      style={{
        position: "absolute",
        left,
        right,
        top,
        width: displayW,
        height: displayH,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poseImageUrl(entry.pose.file)}
        alt={entry.pose.slug}
        draggable={false}
        style={{ width: "100%", height: "100%", userSelect: "none" }}
      />

      {showSafeRegion && entry.safeRegion && (
        <div
          style={{
            position: "absolute",
            left: entry.safeRegion.x * displayW,
            top: entry.safeRegion.y * displayH,
            width: entry.safeRegion.w * displayW,
            height: entry.safeRegion.h * displayH,
            border: "1px dashed rgba(144,78,251,0.55)",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          left: head.center.x * displayW - headDiameter / 2,
          top: head.center.y * displayH - headDiameter / 2,
          width: headDiameter,
          height: headDiameter,
          pointerEvents: "none",
        }}
      >
        <HeadMark
          sizePx={Math.max(1, headDiameter)}
          markBg={FORMAT.navy}
          markFg={ground === "dark" ? "#ffffff" : FORMAT.groundLight}
        />
      </div>
    </div>
  );
}

function gridLine(ground: "dark" | "light"): string {
  return ground === "dark" ? "rgba(123,189,232,0.07)" : "rgba(0,29,57,0.07)";
}

/**
 * Narrow a listbox string back to {@link Layout}.
 *
 * @throws Error if the value is not one of the nine layouts — the picker is
 *         built from the same array, so this can only fire if the two drift.
 */
function asLayout(value: string): Layout {
  const found = LAYOUTS.find((l) => l === value);
  if (!found) {
    throw new Error(
      `[ScenePreview] "${value}" is not a BUSINESS_PLAN_HUB layout. Known: ${LAYOUTS.join(", ")}.`,
    );
  }
  return found;
}
