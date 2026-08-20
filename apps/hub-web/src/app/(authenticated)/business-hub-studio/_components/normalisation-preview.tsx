"use client";

/**
 * Normalisation preview: two poses, side by side, at their computed common
 * collar width.
 *
 * This is the check for the second shipped asset defect — the measured ~6x
 * framing swing between `full-body-standing` (424×1088) and `hands-in-pockets`
 * (2752×1442). Dropping poses into a frame at a common HEIGHT makes the
 * presenter teleport; scaling each so its collar subtends the same number of
 * output pixels is the fix, and this panel is where an operator confirms the fix
 * actually landed for the pair they just calibrated.
 *
 * A pose with no collar hitbox is not drawn at a guessed scale — it is refused,
 * with the reason.
 */

import { useEffect, useRef, useState } from "react";
import type { HeadHitbox, Pose } from "@repo/contracts";

import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import { poseScaleForCollar } from "../_lib/geometry";
import { HeadMark } from "../_lib/head-mark";
import { FORMAT, UI } from "../_lib/palette";
import { poseImageUrl } from "../_lib/api";

/** One pose plus whatever calibration currently applies to it (draft or saved). */
export interface NormalisationEntry {
  pose: Pose;
  collarWidth: number | null;
  head: HeadHitbox | null;
}

interface Props {
  entries: NormalisationEntry[];
  /** Slug the Calibrate tab has open — preselected on the left. */
  focusSlug: string | null;
  ground: "dark" | "light";
}

/** Output frame the preview simulates, from the template's render settings. */
const FRAME_W = 1920;
const FRAME_H = 1080;

/**
 * Default target collar width in output pixels.
 *
 * Not a fallback for missing data — it is the knob this panel exists to tune.
 * 150px at 1920 wide puts the shoulders at roughly the proportion the reference
 * channel uses for a half-body presenter.
 */
const DEFAULT_TARGET_COLLAR_PX = 150;

export function NormalisationPreview({ entries, focusSlug, ground }: Props) {
  const usable = entries.filter((e) => e.collarWidth !== null);
  const [leftSlug, setLeftSlug] = useState<string | null>(null);
  const [rightSlug, setRightSlug] = useState<string | null>(null);
  const [targetCollarPx, setTargetCollarPx] = useState(
    DEFAULT_TARGET_COLLAR_PX,
  );

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
    setLeftSlug((current) => {
      if (current && usable.some((e) => e.pose.slug === current))
        return current;
      if (focusSlug && usable.some((e) => e.pose.slug === focusSlug))
        return focusSlug;
      return usable[0]?.pose.slug ?? null;
    });
    setRightSlug((current) => {
      if (current && usable.some((e) => e.pose.slug === current))
        return current;
      const other = usable.find((e) => e.pose.slug !== focusSlug);
      return other?.pose.slug ?? usable[1]?.pose.slug ?? null;
    });
    // `usable` is derived from `entries` each render; keying on its length and
    // the focus slug is enough and avoids re-running on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, usable.length, focusSlug]);

  if (usable.length < 2) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: UI.surface,
          border: `1px solid ${UI.hairline}`,
          fontSize: 12,
          color: UI.text2,
          lineHeight: 1.6,
        }}
      >
        Two poses need a <code>collar</code> hitbox before their apparent sizes
        can be compared — {usable.length} of {entries.length} have one. Nothing
        is drawn at an assumed collar width, because a comparison against a
        guessed scale would confirm nothing.
      </div>
    );
  }

  const left = usable.find((e) => e.pose.slug === leftSlug) ?? null;
  const right = usable.find((e) => e.pose.slug === rightSlug) ?? null;
  const stageScale = stageWidth > 0 ? stageWidth / FRAME_W : 0;
  const stageHeight = stageWidth > 0 ? stageWidth * (FRAME_H / FRAME_W) : 0;

  const options = usable.map((e) => ({
    value: e.pose.slug,
    label: e.pose.slug,
    hint: `${e.pose.size[0]}×${e.pose.size[1]}`,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <V2Listbox
            label="Left pose"
            value={leftSlug ?? ""}
            onChange={setLeftSlug}
            options={options}
          />
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <V2Listbox
            label="Right pose"
            value={rightSlug ?? ""}
            onChange={setRightSlug}
            options={options}
          />
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: UI.text2,
              marginBottom: 6,
            }}
          >
            Target collar width — {targetCollarPx}px of {FRAME_W}
          </span>
          <input
            type="range"
            min={40}
            max={480}
            step={2}
            value={targetCollarPx}
            onChange={(e) => setTargetCollarPx(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--v2-accent)" }}
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
          background:
            ground === "dark" ? FORMAT.groundDark : FORMAT.groundLight,
          border: `1px solid ${UI.hairline}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(${ground === "dark" ? "rgba(123,189,232,0.07)" : "rgba(0,29,57,0.07)"} 1px, transparent 1px), linear-gradient(90deg, ${ground === "dark" ? "rgba(123,189,232,0.07)" : "rgba(0,29,57,0.07)"} 1px, transparent 1px)`,
            backgroundSize: `${36 * (stageScale || 1)}px ${36 * (stageScale || 1)}px`,
            pointerEvents: "none",
          }}
        />

        {stageScale > 0 && left && (
          <NormalisedFigure
            entry={left}
            side="left"
            targetCollarPx={targetCollarPx}
            stageScale={stageScale}
            stageHeight={stageHeight}
            ground={ground}
          />
        )}
        {stageScale > 0 && right && (
          <NormalisedFigure
            entry={right}
            side="right"
            targetCollarPx={targetCollarPx}
            stageScale={stageScale}
            stageHeight={stageHeight}
            ground={ground}
          />
        )}

        {/* Shared collar guide: if normalisation works, both collars sit on it. */}
        {stageScale > 0 && left?.head && right?.head && (
          <CollarGuide
            left={left}
            right={right}
            targetCollarPx={targetCollarPx}
            stageScale={stageScale}
            stageHeight={stageHeight}
          />
        )}
      </div>

      <div style={{ fontSize: 10, color: UI.text2, lineHeight: 1.6 }}>
        {left && right && (
          <>
            {left.pose.slug}: {left.pose.size[0]}×{left.pose.size[1]} →{" "}
            {describeScale(left, targetCollarPx)} · {right.pose.slug}:{" "}
            {right.pose.size[0]}×{right.pose.size[1]} →{" "}
            {describeScale(right, targetCollarPx)}. If the two figures still
            read at different sizes, one of the two collar measures is wrong —
            not the normalisation.
          </>
        )}
      </div>
    </div>
  );
}

function NormalisedFigure({
  entry,
  side,
  targetCollarPx,
  stageScale,
  stageHeight,
  ground,
}: {
  entry: NormalisationEntry;
  side: "left" | "right";
  targetCollarPx: number;
  stageScale: number;
  stageHeight: number;
  ground: "dark" | "light";
}) {
  const collarWidth = entry.collarWidth;
  if (collarWidth === null) {
    throw new Error(
      `[NormalisationPreview] pose "${entry.pose.slug}" reached the stage with no collar ` +
        "hitbox. Entries are filtered before this point; this is a bug, not a data state.",
    );
  }

  const [poseW, poseH] = entry.pose.size;
  const { widthPx, heightPx } = poseScaleForCollar({
    poseWidthPx: poseW,
    poseHeightPx: poseH,
    collarWidthNorm: collarWidth,
    targetCollarPx,
  });

  const displayW = widthPx * stageScale;
  const displayH = heightPx * stageScale;
  // Bottom-anchored: the figure stands on the bottom edge of the frame.
  const top = stageHeight - displayH;
  const x = side === "left" ? FRAME_W * 0.12 * stageScale : undefined;
  const right = side === "right" ? FRAME_W * 0.12 * stageScale : undefined;

  const head = entry.head;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
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
      {head && (
        <div
          style={{
            position: "absolute",
            left: head.center.x * displayW - head.radius * displayW,
            top: head.center.y * displayH - head.radius * displayW,
            width: head.radius * displayW * 2,
            height: head.radius * displayW * 2,
            pointerEvents: "none",
          }}
        >
          <HeadMark
            sizePx={Math.max(1, head.radius * displayW * 2)}
            markBg={FORMAT.navy}
            markFg={ground === "dark" ? "#ffffff" : FORMAT.groundLight}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A horizontal rule at the average of the two collar heights.
 *
 * The collar's vertical position is not stored (only its width is), so the head
 * hitbox centre is used as the stand-in — it is the anatomical landmark directly
 * above the collar. Two figures whose heads land on the same line at the same
 * size are normalised; two that do not are not.
 */
function CollarGuide({
  left,
  right,
  targetCollarPx,
  stageScale,
  stageHeight,
}: {
  left: NormalisationEntry;
  right: NormalisationEntry;
  targetCollarPx: number;
  stageScale: number;
  stageHeight: number;
}) {
  const y = (entry: NormalisationEntry): number | null => {
    if (entry.collarWidth === null || entry.head === null) return null;
    const [poseW, poseH] = entry.pose.size;
    const { heightPx } = poseScaleForCollar({
      poseWidthPx: poseW,
      poseHeightPx: poseH,
      collarWidthNorm: entry.collarWidth,
      targetCollarPx,
    });
    const displayH = heightPx * stageScale;
    return stageHeight - displayH + entry.head.center.y * displayH;
  };

  const yl = y(left);
  const yr = y(right);
  if (yl === null || yr === null) return null;

  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      width="100%"
      height="100%"
    >
      <line
        x1={0}
        y1={yl}
        x2="100%"
        y2={yl}
        stroke={FORMAT.silver}
        strokeWidth={1}
        strokeDasharray="6 5"
        opacity={0.6}
      />
      {Math.abs(yl - yr) > 1 && (
        <line
          x1={0}
          y1={yr}
          x2="100%"
          y2={yr}
          stroke={FORMAT.clay}
          strokeWidth={1}
          strokeDasharray="6 5"
          opacity={0.8}
        />
      )}
    </svg>
  );
}

function describeScale(
  entry: NormalisationEntry,
  targetCollarPx: number,
): string {
  if (entry.collarWidth === null) return "no collar";
  const [poseW, poseH] = entry.pose.size;
  const { scale, widthPx, heightPx } = poseScaleForCollar({
    poseWidthPx: poseW,
    poseHeightPx: poseH,
    collarWidthNorm: entry.collarWidth,
    targetCollarPx,
  });
  return `×${scale.toFixed(3)} = ${Math.round(widthPx)}×${Math.round(heightPx)}`;
}
