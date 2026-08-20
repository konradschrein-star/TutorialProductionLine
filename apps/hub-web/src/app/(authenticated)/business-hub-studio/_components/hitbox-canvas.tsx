"use client";

/**
 * The calibration canvas: one pose fit to view, with draggable hitboxes over it.
 *
 * All authored values are NORMALISED 0..1 against the pose PNG's own pixel size,
 * so a calibration done in a 900px-wide panel is exactly as valid at 1080p or
 * 2160p. The image is laid out with an explicit `contain` fit rather than CSS
 * `object-fit`, because letterbox bars would otherwise shift every coordinate
 * measured from the container.
 *
 * The collar measure is the odd one out and is labelled as such in the UI: the
 * contract stores only `collar.width`, so the bar's POSITION is a tool-local
 * convenience for lining it up against the shirt, and does not persist.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pose, NormPoint, NormRect } from "@repo/contracts";

import {
  clamp01,
  clampRect,
  displayToNorm,
  fitContain,
  normToDisplay,
  unitDirectionFromPixelDelta,
  type DisplayRect,
  type HitboxDraft,
  type HitboxName,
  type HitboxPatch,
} from "../_lib/geometry";
import { poseImageUrl } from "../_lib/api";
import { HITBOX_COLOURS, UI } from "../_lib/palette";

/** Which sub-handle of a hitbox is being dragged. */
type DragPart =
  | { hitbox: "head"; part: "center" | "radius" }
  | { hitbox: "collar"; part: "left" | "right" | "bar" }
  | { hitbox: "pointOrigin"; part: "point" }
  | { hitbox: "pointDirection"; part: "tip" }
  | { hitbox: "safeRegion" | "crop"; part: RectPart };

type RectPart = "move" | "nw" | "ne" | "sw" | "se";

/** Tool-local placement of the collar measure bar. Only its width persists. */
export interface CollarBarPosition {
  /** Normalised x of the bar's centre. */
  cx: number;
  /** Normalised y of the bar. */
  cy: number;
}

interface Props {
  pose: Pose;
  draft: HitboxDraft;
  /** Hitboxes seeded at a default and not yet dragged — drawn as provisional. */
  seeded: ReadonlySet<HitboxName>;
  visible: Readonly<Record<HitboxName, boolean>>;
  activeHitbox: HitboxName | null;
  collarBar: CollarBarPosition;
  onCollarBarChange: (next: CollarBarPosition) => void;
  onActivate: (name: HitboxName) => void;
  /** Called with a complete replacement value for one hitbox. */
  onChange: (patch: HitboxPatch) => void;
  /** Surface a drag that could not produce a legal value (e.g. zero-length vector). */
  onDragError: (message: string) => void;
}

/** Radius of a grab handle, in CSS pixels. */
const HANDLE_R = 7;

/** Length of the pointing-direction arm on screen, as a fraction of the image. */
const DIRECTION_ARM_FRACTION = 0.2;

export function HitboxCanvas({
  pose,
  draft,
  seeded,
  visible,
  activeHitbox,
  collarBar,
  onCollarBarChange,
  onActivate,
  onChange,
  onDragError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<DragPart | null>(null);
  /** Offset from the rect's top-left to the pointer, for "move" drags. */
  const grabOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [poseWidthPx, poseHeightPx] = pose.size;
  const box: DisplayRect | null =
    size === null
      ? null
      : fitContain(
          { w: poseWidthPx, h: poseHeightPx },
          { w: size.w, h: size.h },
        );

  const pointerNorm = useCallback(
    (event: React.PointerEvent, imageBox: DisplayRect): NormPoint => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        throw new Error(
          "[HitboxCanvas] pointer event fired before the canvas was laid out.",
        );
      }
      return displayToNorm(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        imageBox,
      );
    },
    [],
  );

  const pointerDisplay = useCallback(
    (event: React.PointerEvent): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        throw new Error(
          "[HitboxCanvas] pointer event fired before the canvas was laid out.",
        );
      }
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  function beginDrag(
    event: React.PointerEvent,
    part: DragPart,
    imageBox: DisplayRect,
  ) {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = part;
    onActivate(part.hitbox);

    if (part.hitbox === "safeRegion" || part.hitbox === "crop") {
      const rect = draft[part.hitbox];
      if (rect && part.part === "move") {
        const p = pointerNorm(event, imageBox);
        grabOffsetRef.current = { dx: p.x - rect.x, dy: p.y - rect.y };
      }
    }
    if (part.hitbox === "collar" && part.part === "bar") {
      const p = pointerNorm(event, imageBox);
      grabOffsetRef.current = {
        dx: p.x - collarBar.cx,
        dy: p.y - collarBar.cy,
      };
    }
  }

  function endDrag(event: React.PointerEvent) {
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  }

  function handleMove(event: React.PointerEvent, imageBox: DisplayRect) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();

    try {
      applyDrag(drag, event, imageBox);
    } catch (error) {
      onDragError(error instanceof Error ? error.message : String(error));
    }
  }

  function applyDrag(
    drag: DragPart,
    event: React.PointerEvent,
    imageBox: DisplayRect,
  ) {
    const norm = pointerNorm(event, imageBox);
    const disp = pointerDisplay(event);

    switch (drag.hitbox) {
      case "head": {
        const head = draft.head;
        if (!head) return;
        if (drag.part === "center") {
          onChange({
            name: "head",
            value: { center: norm, radius: head.radius },
          });
        } else {
          // radius is a fraction of the pose WIDTH (contracts), so it is
          // measured along x in display pixels and divided by the box width.
          const centreDisp = normToDisplay(head.center, imageBox);
          const radiusPx = Math.hypot(
            disp.x - centreDisp.x,
            disp.y - centreDisp.y,
          );
          const radius = Math.min(1, Math.max(0.002, radiusPx / imageBox.w));
          onChange({ name: "head", value: { center: head.center, radius } });
        }
        return;
      }
      case "collar": {
        const collar = draft.collar;
        if (!collar) return;
        if (drag.part === "bar") {
          onCollarBarChange({
            cx: clamp01(norm.x - grabOffsetRef.current.dx),
            cy: clamp01(norm.y - grabOffsetRef.current.dy),
          });
          return;
        }
        // Symmetric measure: dragging either end sets the half-width, so the
        // bar stays centred on the point the operator lined it up with.
        const halfWidth = Math.abs(norm.x - collarBar.cx);
        const width = Math.min(1, Math.max(0.002, halfWidth * 2));
        onChange({ name: "collar", value: { width } });
        return;
      }
      case "pointOrigin": {
        onChange({ name: "pointOrigin", value: norm });
        return;
      }
      case "pointDirection": {
        const origin = draft.pointOrigin;
        if (!origin) return;
        const originDisp = normToDisplay(origin, imageBox);
        // Measured in DISPLAY pixels, which are a uniform scaling of pose
        // pixels under a contain fit — so the unit vector is the same in both.
        onChange({
          name: "pointDirection",
          value: unitDirectionFromPixelDelta(
            disp.x - originDisp.x,
            disp.y - originDisp.y,
          ),
        });
        return;
      }
      case "safeRegion":
      case "crop": {
        const rect = draft[drag.hitbox];
        if (!rect) return;
        onChange({
          name: drag.hitbox,
          value: resizeRect(rect, drag.part, norm, grabOffsetRef.current),
        });
        return;
      }
      default: {
        const exhaustive: never = drag;
        throw new Error(
          `[HitboxCanvas] unhandled drag target: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 420,
        borderRadius: 12,
        border: `1px solid ${UI.hairline}`,
        // A checker so a transparent matte edge is visible; the poses are RGBA
        // and a solid backdrop hides a bad cut-out.
        backgroundColor: "#111417",
        backgroundImage:
          "linear-gradient(45deg, #16191d 25%, transparent 25%), linear-gradient(-45deg, #16191d 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #16191d 75%), linear-gradient(-45deg, transparent 75%, #16191d 75%)",
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        overflow: "hidden",
        touchAction: "none",
      }}
      onPointerMove={(e) => box && handleMove(e, box)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {box && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poseImageUrl(pose.file)}
          alt={pose.slug}
          draggable={false}
          style={{
            position: "absolute",
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      )}

      {box && size && (
        <svg
          width={size.w}
          height={size.h}
          style={{ position: "absolute", inset: 0 }}
        >
          {visible.crop && draft.crop && (
            <RectOverlay
              rect={draft.crop}
              box={box}
              colour={HITBOX_COLOURS.crop}
              label="crop"
              provisional={seeded.has("crop")}
              active={activeHitbox === "crop"}
              onPart={(part, e) => beginDrag(e, { hitbox: "crop", part }, box)}
            />
          )}

          {visible.safeRegion && draft.safeRegion && (
            <RectOverlay
              rect={draft.safeRegion}
              box={box}
              colour={HITBOX_COLOURS.safeRegion}
              label="safeRegion"
              provisional={seeded.has("safeRegion")}
              active={activeHitbox === "safeRegion"}
              onPart={(part, e) =>
                beginDrag(e, { hitbox: "safeRegion", part }, box)
              }
            />
          )}

          {visible.collar && draft.collar && (
            <CollarOverlay
              widthNorm={draft.collar.width}
              bar={collarBar}
              box={box}
              provisional={seeded.has("collar")}
              active={activeHitbox === "collar"}
              onBar={(e) =>
                beginDrag(e, { hitbox: "collar", part: "bar" }, box)
              }
              onEnd={(side, e) =>
                beginDrag(e, { hitbox: "collar", part: side }, box)
              }
            />
          )}

          {visible.head && draft.head && (
            <HeadOverlay
              centre={draft.head.center}
              radiusNorm={draft.head.radius}
              box={box}
              provisional={seeded.has("head")}
              active={activeHitbox === "head"}
              onCentre={(e) =>
                beginDrag(e, { hitbox: "head", part: "center" }, box)
              }
              onRadius={(e) =>
                beginDrag(e, { hitbox: "head", part: "radius" }, box)
              }
            />
          )}

          {visible.pointOrigin && draft.pointOrigin && (
            <PointerOverlay
              origin={draft.pointOrigin}
              direction={visible.pointDirection ? draft.pointDirection : null}
              box={box}
              provisionalOrigin={seeded.has("pointOrigin")}
              provisionalDirection={seeded.has("pointDirection")}
              active={
                activeHitbox === "pointOrigin" ||
                activeHitbox === "pointDirection"
              }
              onOrigin={(e) =>
                beginDrag(e, { hitbox: "pointOrigin", part: "point" }, box)
              }
              onTip={(e) =>
                beginDrag(e, { hitbox: "pointDirection", part: "tip" }, box)
              }
            />
          )}
        </svg>
      )}

      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 8,
          fontSize: 10,
          color: UI.text2,
          letterSpacing: "0.04em",
          pointerEvents: "none",
        }}
      >
        {pose.slug} · {poseWidthPx}×{poseHeightPx}px
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlays
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply a rect drag.
 *
 * Corner drags pin the opposite corner, so a rect can be inverted through zero
 * without flipping sign — `clampRect` re-normalises and enforces the minimum
 * size that `NormRectSchema`'s `w > 0` requires.
 */
function resizeRect(
  rect: NormRect,
  part: RectPart,
  pointer: NormPoint,
  grabOffset: { dx: number; dy: number },
): NormRect {
  switch (part) {
    case "move":
      return clampRect({
        x: pointer.x - grabOffset.dx,
        y: pointer.y - grabOffset.dy,
        w: rect.w,
        h: rect.h,
      });
    case "nw":
      return cornerRect(pointer, { x: rect.x + rect.w, y: rect.y + rect.h });
    case "ne":
      return cornerRect(
        { x: rect.x, y: pointer.y },
        { x: pointer.x, y: rect.y + rect.h },
      );
    case "sw":
      return cornerRect(
        { x: pointer.x, y: rect.y },
        { x: rect.x + rect.w, y: pointer.y },
      );
    case "se":
      return cornerRect({ x: rect.x, y: rect.y }, pointer);
    default: {
      const exhaustive: never = part;
      throw new Error(
        `[HitboxCanvas] unhandled rect part: ${String(exhaustive)}`,
      );
    }
  }
}

function cornerRect(a: NormPoint, b: NormPoint): NormRect {
  return clampRect({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  });
}

function RectOverlay(props: {
  rect: NormRect;
  box: DisplayRect;
  colour: string;
  label: string;
  provisional: boolean;
  active: boolean;
  onPart: (part: RectPart, event: React.PointerEvent) => void;
}) {
  const { rect, box, colour, label, provisional, active, onPart } = props;
  const x = box.x + rect.x * box.w;
  const y = box.y + rect.y * box.h;
  const w = rect.w * box.w;
  const h = rect.h * box.h;
  const corners: Array<{ part: RectPart; cx: number; cy: number }> = [
    { part: "nw", cx: x, cy: y },
    { part: "ne", cx: x + w, cy: y },
    { part: "sw", cx: x, cy: y + h },
    { part: "se", cx: x + w, cy: y + h },
  ];

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={active ? `${colour}18` : "transparent"}
        stroke={colour}
        strokeWidth={active ? 2 : 1.25}
        strokeDasharray={provisional ? "6 4" : undefined}
        style={{ cursor: "move" }}
        onPointerDown={(e) => onPart("move", e)}
      />
      <text
        x={x + 4}
        y={y - 5}
        fill={colour}
        fontSize={10}
        fontFamily="Inter, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
        {provisional ? " (seeded)" : ""}
      </text>
      {corners.map((corner) => (
        <rect
          key={corner.part}
          x={corner.cx - HANDLE_R}
          y={corner.cy - HANDLE_R}
          width={HANDLE_R * 2}
          height={HANDLE_R * 2}
          fill={colour}
          stroke="#000"
          strokeWidth={1}
          style={{
            cursor:
              corner.part === "nw" || corner.part === "se"
                ? "nwse-resize"
                : "nesw-resize",
          }}
          onPointerDown={(e) => onPart(corner.part, e)}
        />
      ))}
    </g>
  );
}

function HeadOverlay(props: {
  centre: NormPoint;
  radiusNorm: number;
  box: DisplayRect;
  provisional: boolean;
  active: boolean;
  onCentre: (event: React.PointerEvent) => void;
  onRadius: (event: React.PointerEvent) => void;
}) {
  const { centre, radiusNorm, box, provisional, active, onCentre, onRadius } =
    props;
  const c = normToDisplay(centre, box);
  // radius is a fraction of the pose WIDTH so the mark stays circular.
  const r = radiusNorm * box.w;
  const colour = HITBOX_COLOURS.head;

  return (
    <g>
      <circle
        cx={c.x}
        cy={c.y}
        r={r}
        fill={active ? `${colour}22` : `${colour}12`}
        stroke={colour}
        strokeWidth={active ? 2 : 1.25}
        strokeDasharray={provisional ? "6 4" : undefined}
        style={{ cursor: "grab" }}
        onPointerDown={onCentre}
      />
      <line
        x1={c.x}
        y1={c.y}
        x2={c.x + r}
        y2={c.y}
        stroke={colour}
        strokeWidth={1}
        strokeDasharray="3 3"
        style={{ pointerEvents: "none" }}
      />
      <circle
        cx={c.x}
        cy={c.y}
        r={HANDLE_R - 2}
        fill={colour}
        stroke="#000"
        style={{ cursor: "grab" }}
        onPointerDown={onCentre}
      />
      <circle
        cx={c.x + r}
        cy={c.y}
        r={HANDLE_R}
        fill={colour}
        stroke="#000"
        style={{ cursor: "ew-resize" }}
        onPointerDown={onRadius}
      />
      <text
        x={c.x + 6}
        y={c.y - r - 6}
        fill={colour}
        fontSize={10}
        fontFamily="Inter, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        head{provisional ? " (seeded)" : ""}
      </text>
    </g>
  );
}

function CollarOverlay(props: {
  widthNorm: number;
  bar: CollarBarPosition;
  box: DisplayRect;
  provisional: boolean;
  active: boolean;
  onBar: (event: React.PointerEvent) => void;
  onEnd: (side: "left" | "right", event: React.PointerEvent) => void;
}) {
  const { widthNorm, bar, box, provisional, active, onBar, onEnd } = props;
  const colour = HITBOX_COLOURS.collar;
  const cx = box.x + bar.cx * box.w;
  const cy = box.y + bar.cy * box.h;
  const half = (widthNorm * box.w) / 2;

  return (
    <g>
      <line
        x1={cx - half}
        y1={cy}
        x2={cx + half}
        y2={cy}
        stroke={colour}
        strokeWidth={active ? 3 : 2}
        strokeDasharray={provisional ? "6 4" : undefined}
        style={{ cursor: "move" }}
        onPointerDown={onBar}
      />
      {[-1, 1].map((sign) => (
        <line
          key={sign}
          x1={cx + sign * half}
          y1={cy - 14}
          x2={cx + sign * half}
          y2={cy + 14}
          stroke={colour}
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />
      ))}
      <circle
        cx={cx - half}
        cy={cy}
        r={HANDLE_R}
        fill={colour}
        stroke="#000"
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => onEnd("left", e)}
      />
      <circle
        cx={cx + half}
        cy={cy}
        r={HANDLE_R}
        fill={colour}
        stroke="#000"
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => onEnd("right", e)}
      />
      <text
        x={cx - half}
        y={cy + 28}
        fill={colour}
        fontSize={10}
        fontFamily="Inter, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        collar {(widthNorm * 100).toFixed(2)}% of width
        {provisional ? " (seeded)" : ""}
      </text>
    </g>
  );
}

function PointerOverlay(props: {
  origin: NormPoint;
  direction: { x: number; y: number } | null;
  box: DisplayRect;
  provisionalOrigin: boolean;
  provisionalDirection: boolean;
  active: boolean;
  onOrigin: (event: React.PointerEvent) => void;
  onTip: (event: React.PointerEvent) => void;
}) {
  const {
    origin,
    direction,
    box,
    provisionalOrigin,
    provisionalDirection,
    active,
    onOrigin,
    onTip,
  } = props;
  const colour = HITBOX_COLOURS.pointOrigin;
  const o = normToDisplay(origin, box);
  const arm = DIRECTION_ARM_FRACTION * Math.min(box.w, box.h);
  const tip =
    direction === null
      ? null
      : { x: o.x + direction.x * arm, y: o.y + direction.y * arm };

  return (
    <g>
      {tip && (
        <>
          <line
            x1={o.x}
            y1={o.y}
            x2={tip.x}
            y2={tip.y}
            stroke={colour}
            strokeWidth={active ? 3 : 2}
            strokeDasharray={provisionalDirection ? "6 4" : undefined}
            style={{ pointerEvents: "none" }}
          />
          <circle
            cx={tip.x}
            cy={tip.y}
            r={HANDLE_R}
            fill={colour}
            stroke="#000"
            style={{ cursor: "grab" }}
            onPointerDown={onTip}
          />
        </>
      )}
      <circle
        cx={o.x}
        cy={o.y}
        r={HANDLE_R + 1}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeDasharray={provisionalOrigin ? "4 3" : undefined}
        style={{ pointerEvents: "none" }}
      />
      <circle
        cx={o.x}
        cy={o.y}
        r={HANDLE_R - 1}
        fill={colour}
        stroke="#000"
        style={{ cursor: "grab" }}
        onPointerDown={onOrigin}
      />
      <text
        x={o.x + 10}
        y={o.y + 16}
        fill={colour}
        fontSize={10}
        fontFamily="Inter, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        pointOrigin{provisionalOrigin ? " (seeded)" : ""}
      </text>
    </g>
  );
}
