/**
 * Presenter Studio geometry — the pure maths behind the hitbox canvas.
 *
 * Everything here is a total function over plain numbers so it can be unit
 * tested without a DOM. Two of these deliberately MIRROR functions in
 * `@repo/media-core` (`computePoseScale`, `buildHeadScaleSteps` +
 * `quantiseEnvelopeToSteps`) rather than importing them: the media-core barrel
 * pulls in `node:child_process` and `execa`, which cannot be bundled into a
 * client component. The mirrors are marked and must stay numerically identical —
 * a preview that scales differently from the renderer is worse than no preview.
 * `docs/superpowers/handoff/U1.md` asks R4/INT for a `./presenter` subpath export
 * so these can be deleted.
 *
 * COORDINATE SPACES — three of them, and mixing them up is the whole bug class:
 *  - NORMALISED: 0..1 fractions of the pose PNG's own width/height. This is what
 *    `poses.json` stores, so it survives any output resolution.
 *  - DISPLAY: CSS pixels inside the fitted <img> box on screen.
 *  - POSE PIXELS: the PNG's native pixels.
 *
 * `pointDirection` is the exception and is documented at
 * {@link unitDirectionFromPixelDelta}.
 */

import type {
  HeadHitbox,
  CollarHitbox,
  NormPoint,
  NormRect,
  NormVector,
  PoseHitboxes,
} from "@repo/contracts";

/** The six hitboxes a pose must carry before it can be placed. */
export const HITBOX_NAMES = [
  "head",
  "collar",
  "pointOrigin",
  "pointDirection",
  "safeRegion",
  "crop",
] as const;

export type HitboxName = (typeof HITBOX_NAMES)[number];

/**
 * A pose mid-calibration. Every member may be `null` because the operator has
 * not authored it yet — this is the ONLY representation of a partially authored
 * pose. It never reaches disk: {@link draftToHitboxes} returns `null` unless all
 * six are present, and the save route rejects a "calibrated" pose without them.
 */
export interface HitboxDraft {
  head: HeadHitbox | null;
  collar: CollarHitbox | null;
  pointOrigin: NormPoint | null;
  pointDirection: NormVector | null;
  safeRegion: NormRect | null;
  crop: NormRect | null;
}

/** A draft with nothing authored. */
export function emptyDraft(): HitboxDraft {
  return {
    head: null,
    collar: null,
    pointOrigin: null,
    pointDirection: null,
    safeRegion: null,
    crop: null,
  };
}

/** Widen a complete hitbox set into a draft (for editing an existing pose). */
export function draftFromHitboxes(hitboxes: PoseHitboxes): HitboxDraft {
  return {
    head: hitboxes.head,
    collar: hitboxes.collar,
    pointOrigin: hitboxes.pointOrigin,
    pointDirection: hitboxes.pointDirection,
    safeRegion: hitboxes.safeRegion,
    crop: hitboxes.crop,
  };
}

/**
 * Narrow a draft to a complete hitbox set.
 *
 * @returns The set, or `null` if any member is still unauthored. Never fills a
 *          gap: a guessed head position is exactly what design §8 rule 2 forbids.
 */
export function draftToHitboxes(draft: HitboxDraft): PoseHitboxes | null {
  const { head, collar, pointOrigin, pointDirection, safeRegion, crop } = draft;
  if (
    head === null ||
    collar === null ||
    pointOrigin === null ||
    pointDirection === null ||
    safeRegion === null ||
    crop === null
  ) {
    return null;
  }
  return { head, collar, pointOrigin, pointDirection, safeRegion, crop };
}

/** Which hitboxes are still unauthored, in canonical order. */
export function missingHitboxes(draft: HitboxDraft): HitboxName[] {
  return HITBOX_NAMES.filter((name) => draft[name] === null);
}

/**
 * A single authored value, as a discriminated union.
 *
 * Deliberately not a generic `(name: K, value: HitboxDraft[K])` pair: a union
 * lets {@link applyHitboxPatch} narrow name and value together in one exhaustive
 * switch, so adding a seventh hitbox to {@link HITBOX_NAMES} becomes a compile
 * error here rather than a silently ignored case.
 */
export type HitboxPatch =
  | { name: "head"; value: HeadHitbox }
  | { name: "collar"; value: CollarHitbox }
  | { name: "pointOrigin"; value: NormPoint }
  | { name: "pointDirection"; value: NormVector }
  | { name: "safeRegion"; value: NormRect }
  | { name: "crop"; value: NormRect };

/**
 * Apply one authored value to a draft.
 *
 * @returns A new draft. Never mutates the input.
 * @throws Error on an unknown hitbox name (unreachable while the switch is
 *         exhaustive; the `never` check is what keeps it that way).
 */
export function applyHitboxPatch(
  draft: HitboxDraft,
  patch: HitboxPatch,
): HitboxDraft {
  switch (patch.name) {
    case "head":
      return { ...draft, head: patch.value };
    case "collar":
      return { ...draft, collar: patch.value };
    case "pointOrigin":
      return { ...draft, pointOrigin: patch.value };
    case "pointDirection":
      return { ...draft, pointDirection: patch.value };
    case "safeRegion":
      return { ...draft, safeRegion: patch.value };
    case "crop":
      return { ...draft, crop: patch.value };
    default: {
      const exhaustive: never = patch;
      throw new Error(
        `[studio-geometry] applyHitboxPatch: unknown hitbox ${JSON.stringify(exhaustive)}.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clamping and conversion
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp to the 0..1 range the contracts schema enforces. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `[studio-geometry] clamp01 received ${String(value)}, not a finite number. ` +
        "A NaN coordinate means a pointer event was measured against a zero-sized element.",
    );
  }
  return Math.min(1, Math.max(0, value));
}

/** An axis-aligned box in display (CSS pixel) space. */
export interface DisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `object-fit: contain` geometry: the largest box with `natural`'s aspect ratio
 * that fits inside `container`, centred.
 *
 * The canvas needs this explicitly rather than leaning on CSS, because hitbox
 * coordinates are normalised against the IMAGE, not the container — letterbox
 * bars must not shift them.
 *
 * @throws Error if either size is not positive; a zero-sized container means the
 *         caller measured before layout and every coordinate derived from it
 *         would be garbage.
 */
export function fitContain(
  natural: { w: number; h: number },
  container: { w: number; h: number },
): DisplayRect {
  for (const [label, value] of [
    ["natural.w", natural.w],
    ["natural.h", natural.h],
    ["container.w", container.w],
    ["container.h", container.h],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `[studio-geometry] fitContain: ${label} must be finite and > 0, got ${value}.`,
      );
    }
  }
  const scale = Math.min(container.w / natural.w, container.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: (container.w - w) / 2, y: (container.h - h) / 2, w, h };
}

/** Display pixel position of a normalised point inside a fitted image box. */
export function normToDisplay(
  point: NormPoint,
  box: DisplayRect,
): { x: number; y: number } {
  return { x: box.x + point.x * box.w, y: box.y + point.y * box.h };
}

/**
 * Normalised position of a display pixel inside a fitted image box, clamped to
 * 0..1 so a drag that leaves the image cannot author an out-of-range value.
 */
export function displayToNorm(
  pos: { x: number; y: number },
  box: DisplayRect,
): NormPoint {
  if (box.w <= 0 || box.h <= 0) {
    throw new Error(
      `[studio-geometry] displayToNorm: image box is ${box.w}x${box.h}. ` +
        "Nothing can be placed against a zero-sized box.",
    );
  }
  return {
    x: clamp01((pos.x - box.x) / box.w),
    y: clamp01((pos.y - box.y) / box.h),
  };
}

/**
 * Clamp a rect so it stays inside the image.
 *
 * `NormRectSchema` rejects `x + w > 1`, so a drag that would push a rect off the
 * edge is corrected here rather than failing at save time with a message the
 * operator cannot connect to the handle they were dragging.
 */
export function clampRect(rect: NormRect, minSize = 0.01): NormRect {
  const w = Math.min(1, Math.max(minSize, rect.w));
  const h = Math.min(1, Math.max(minSize, rect.h));
  return {
    x: Math.min(Math.max(0, rect.x), 1 - w),
    y: Math.min(Math.max(0, rect.y), 1 - h),
    w,
    h,
  };
}

/** Build a normalised rect from two corner points in any order. */
export function rectFromCorners(a: NormPoint, b: NormPoint): NormRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return clampRect({ x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
}

// ─────────────────────────────────────────────────────────────────────────────
// pointDirection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn a drag delta measured in PIXELS into the stored unit direction vector.
 *
 * WHICH SPACE, AND WHY: a direction expressed as a delta of NORMALISED
 * coordinates is skewed by the image's aspect ratio — the same physical arm
 * angle gives a different `atan2` on a 424x1088 pose than on a 2752x1442 one,
 * so an object rotated by it would sit at a different angle per pose. Pose PNGs
 * are scaled UNIFORMLY by `computePoseScale`, so a direction in pose-pixel space
 * survives scaling exactly and is the same angle on screen. That is the space
 * used here. The vector is stored at unit length, which keeps both components
 * inside the -1..1 the contracts schema allows and makes only the angle
 * meaningful.
 *
 * @throws Error on a zero-length delta — "points nowhere" is not a direction,
 *         and `NormVectorSchema` rejects it too. The caller should ignore a
 *         drag that has not moved rather than store a default heading.
 */
export function unitDirectionFromPixelDelta(
  dx: number,
  dy: number,
): NormVector {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error(
      `[studio-geometry] unitDirectionFromPixelDelta: got (${dx}, ${dy}); both must be finite.`,
    );
  }
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    throw new Error(
      "[studio-geometry] unitDirectionFromPixelDelta: the drag has zero length, so it " +
        "names no direction. Refusing to store a default heading — move the handle away " +
        "from the pointing origin.",
    );
  }
  return { x: dx / length, y: dy / length };
}

/**
 * On-screen angle of a stored `pointDirection`, in degrees, clockwise from the
 * +x axis (screen y grows downward, so this is the angle a CSS `rotate()` needs).
 *
 * This is what `framed-chart` rotates its frame by, per design §3.2.
 */
export function directionAngleDeg(direction: NormVector): number {
  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apparent-scale normalisation — MIRROR of media-core computePoseScale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uniform scale that makes a pose's collar subtend `targetCollarPx`.
 *
 * MIRROR of `computePoseScale` in
 * `packages/media-core/src/presenter/pose-normalise.ts`. Same formula, same
 * failure conditions; it does not round to even pixels because a DOM preview has
 * no chroma plane to satisfy.
 *
 * This is the fix for the measured ~6x framing swing (424x1088 to 2752x1442):
 * hold `targetCollarPx` constant across poses and the figure stops teleporting.
 *
 * @throws Error if the pose size or collar width is not a positive number, if
 *         the collar width is not a 0..1 fraction, or if the result is degenerate.
 */
export function poseScaleForCollar(params: {
  poseWidthPx: number;
  poseHeightPx: number;
  collarWidthNorm: number;
  targetCollarPx: number;
}): { scale: number; widthPx: number; heightPx: number } {
  const { poseWidthPx, poseHeightPx, collarWidthNorm, targetCollarPx } = params;

  for (const [label, value] of [
    ["poseWidthPx", poseWidthPx],
    ["poseHeightPx", poseHeightPx],
    ["collarWidthNorm", collarWidthNorm],
    ["targetCollarPx", targetCollarPx],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `[studio-geometry] poseScaleForCollar: ${label} must be finite and > 0, got ${value}.`,
      );
    }
  }
  if (collarWidthNorm > 1) {
    throw new Error(
      `[studio-geometry] poseScaleForCollar: collarWidthNorm must be a 0..1 fraction of the ` +
        `pose image width, got ${collarWidthNorm} — that looks like a pixel value.`,
    );
  }

  const scale = targetCollarPx / (collarWidthNorm * poseWidthPx);
  const widthPx = poseWidthPx * scale;
  const heightPx = poseHeightPx * scale;

  if (widthPx < 2 || heightPx < 2) {
    throw new Error(
      `[studio-geometry] poseScaleForCollar: targetCollarPx=${targetCollarPx} scales this pose ` +
        `to ${widthPx.toFixed(3)}x${heightPx.toFixed(3)}px, which is not renderable.`,
    );
  }

  return { scale, widthPx, heightPx };
}

// ─────────────────────────────────────────────────────────────────────────────
// Head pump — MIRROR of media-core buildHeadScaleSteps + quantiseEnvelopeToSteps
// ─────────────────────────────────────────────────────────────────────────────

/** Design §4.3: the envelope maps to head scale in roughly 1.00-1.08. */
export const HEAD_SCALE_RANGE = { min: 1.0, max: 1.08 } as const;

/** Distinct head rasterisations the renderer quantises to. */
export const HEAD_SCALE_STEPS = 33;

/**
 * Head scale for one normalised envelope value.
 *
 * MIRROR of `buildHeadScaleSteps(range, steps)[quantiseEnvelopeToSteps(v, steps)]`
 * in `packages/media-core/src/presenter/presenter-track.ts`. The quantisation is
 * reproduced rather than skipped: the shipped animation only has 33 distinct
 * sizes, and a preview showing a continuous ramp would flatter it.
 *
 * @throws Error if `value` is not a finite number in 0..1 — that means the
 *         envelope did not come from `normaliseEnvelope`, and clamping it would
 *         hide the fault.
 */
export function headScaleForEnvelopeValue(
  value: number,
  range: { min: number; max: number } = HEAD_SCALE_RANGE,
  steps: number = HEAD_SCALE_STEPS,
): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `[studio-geometry] headScaleForEnvelopeValue: envelope value is ${String(value)}, ` +
        "expected a finite number in 0..1.",
    );
  }
  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error(
      `[studio-geometry] headScaleForEnvelopeValue: steps must be an integer >= 2, got ${steps}.`,
    );
  }
  if (!Number.isFinite(range.min) || range.min <= 0 || range.max < range.min) {
    throw new Error(
      `[studio-geometry] headScaleForEnvelopeValue: bad range {min: ${range.min}, max: ${range.max}}.`,
    );
  }
  const index = Math.round(value * (steps - 1));
  return range.min + ((range.max - range.min) * index) / (steps - 1);
}

/**
 * Envelope index for a playback position.
 *
 * @returns The frame index, clamped to the last frame. `null` when the envelope
 *          is empty — the caller must then render no pump at all rather than
 *          falling back to scale 1.0 and pretending it is animating.
 * @throws Error if `fps` is not positive or `timeSec` is negative/non-finite.
 */
export function envelopeIndexAt(
  timeSec: number,
  fps: number,
  frameCount: number,
): number | null {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[studio-geometry] envelopeIndexAt: fps must be finite and > 0, got ${fps}.`,
    );
  }
  if (!Number.isFinite(timeSec) || timeSec < 0) {
    throw new Error(
      `[studio-geometry] envelopeIndexAt: timeSec must be finite and >= 0, got ${timeSec}.`,
    );
  }
  if (frameCount <= 0) return null;
  return Math.min(frameCount - 1, Math.floor(timeSec * fps));
}
