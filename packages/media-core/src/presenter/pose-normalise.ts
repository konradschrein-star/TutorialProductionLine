/**
 * Presenter pose normalisation — apparent-scale and placement math.
 *
 * THE PROBLEM THIS SOLVES (design §3.3, defect 2):
 * The 16 pose PNGs were matted from crops of wildly different size —
 * `full-body-standing` is 424x1088, `hands-in-pockets` is 2752x1442. That is
 * roughly a 6x swing in how large the figure reads. Dropping them into a frame
 * at a common height makes the presenter teleport between shots.
 *
 * THE FIX:
 * Every pose carries a `collar` hitbox: the collar width as a fraction of the
 * pose image width. The collar is the one feature every pose shares at a
 * consistent anatomical size. Scaling each pose so its collar subtends the same
 * number of output pixels makes all 16 read at one apparent size, regardless of
 * how they were cropped.
 *
 * Everything in this file is pure and unit-tested. No ffmpeg, no filesystem.
 *
 * FAIL-CLOSED: an uncalibrated pose throws. `poses.json` today has
 * `anchor_status: "needs-calibration"` and no `hitboxes` on all 16 entries, so
 * {@link requireCalibratedPose} throws for every pose until the Presenter
 * Studio (task U1) writes them. That is intended — a guessed head position is
 * worse than a failed build.
 */

import { CalibratedPoseSchema } from "@repo/contracts";
import type { CalibratedPose } from "@repo/contracts";

/** Which side of the frame the figure stands on. */
export type PresenterSide = "left" | "right" | "center";

/**
 * Where and how large the figure sits in the output frame.
 *
 * All fractions are of the OUTPUT frame, not the pose image.
 */
export interface PresenterPlacement {
  side: PresenterSide;
  /**
   * Target on-screen collar width in output pixels. This is the apparent-size
   * knob: hold it constant across scenes and the presenter stops teleporting.
   */
  targetCollarPx: number;
  /**
   * Fraction of frame height at which the figure's bottom edge sits.
   * 1 = flush with the bottom of the frame; > 1 pushes the figure off-frame
   * (legitimate for `presenter-solo`, which is cropped by the frame edge).
   */
  bottomAnchor: number;
  /**
   * Fraction of frame width inset from the left or right edge.
   * Ignored when `side === "center"`. May be negative to bleed off-frame.
   */
  sideInset: number;
  /**
   * Mirror the figure horizontally. Most poses face one way; a `side: "right"`
   * placement usually wants the figure facing back into frame. Mirroring also
   * mirrors the head hitbox, which is handled here — do not mirror by hand.
   */
  mirror?: boolean;
}

/** Uniform scale derived from the collar hitbox. */
export interface PoseScale {
  /** Uniform multiplier applied to the pose PNG. */
  scale: number;
  /** Scaled pose width in whole (even) pixels. */
  scaledWidthPx: number;
  /** Scaled pose height in whole (even) pixels. */
  scaledHeightPx: number;
}

/** Resolved geometry for one presenter placement, in output-frame pixels. */
export interface PresenterLayout {
  scale: number;
  suit: {
    widthPx: number;
    heightPx: number;
    /** Top-left x of the scaled suit inside the output frame. May be negative. */
    xPx: number;
    /** Top-left y of the scaled suit inside the output frame. May be negative. */
    yPx: number;
    mirrored: boolean;
  };
  head: {
    /** Head mark centre x in the output frame. */
    centreXPx: number;
    /** Head mark centre y in the output frame. */
    centreYPx: number;
    /** Head mark diameter at scale 1.0 (before the loudness pump). */
    diameterPx: number;
  };
}

/** Round up to the next even integer — VP9/yuv chroma planes want even sizes. */
function evenCeil(value: number): number {
  const ceiled = Math.ceil(value);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

function requireFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[pose-normalise] ${name} must be finite and > 0, got ${value}.`,
    );
  }
}

/**
 * Assert that a pose entry is render-ready and narrow it to {@link CalibratedPose}.
 *
 * Accepts `unknown` on purpose: callers read `poses.json` off disk, and the
 * whole point is that an uncalibrated entry must not flow into layout math.
 *
 * @throws Error naming the pose slug (when it can be recovered) and pointing at
 *         the Presenter Studio, if the entry is not `anchor_status:
 *         "calibrated"` with a complete hitbox set.
 */
export function requireCalibratedPose(pose: unknown): CalibratedPose {
  const parsed = CalibratedPoseSchema.safeParse(pose);
  if (parsed.success) return parsed.data;

  const slug =
    typeof pose === "object" &&
    pose !== null &&
    "slug" in pose &&
    typeof (pose as { slug: unknown }).slug === "string"
      ? (pose as { slug: string }).slug
      : "<unknown slug>";

  throw new Error(
    `[pose-normalise] pose "${slug}" is not calibrated and cannot be placed. ` +
      "A pose needs head, collar, pointOrigin, pointDirection, safeRegion and crop " +
      'hitboxes plus anchor_status:"calibrated" before anything may position it. ' +
      "All 16 entries in media/style-assets/presenter/poses/poses.json currently read " +
      'anchor_status:"needs-calibration" — author them in the Presenter Studio ' +
      "(/business-hub-studio). Nothing here will guess a head position. " +
      `Validation detail: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
  );
}

/**
 * Uniform scale that makes this pose's collar subtend `targetCollarPx`.
 *
 * This is the fix for the 6x framing swing: it is measured off the collar
 * hitbox, not off the image height, so a tightly cropped pose and a
 * full-body pose come out at the same apparent size.
 *
 * @throws Error if the pose size or collar width is not positive, or if the
 *         resulting scaled image would round to zero pixels.
 */
export function computePoseScale(params: {
  /** Pose PNG pixel size, `[width, height]`. */
  poseSizePx: readonly [number, number];
  /** Collar width as a fraction of the pose image width (hitboxes.collar.width). */
  collarWidthNorm: number;
  /** Desired on-screen collar width in output pixels. */
  targetCollarPx: number;
}): PoseScale {
  const { poseSizePx, collarWidthNorm, targetCollarPx } = params;
  const [poseWidthPx, poseHeightPx] = poseSizePx;

  requireFinitePositive("poseSizePx[0]", poseWidthPx);
  requireFinitePositive("poseSizePx[1]", poseHeightPx);
  requireFinitePositive("collarWidthNorm", collarWidthNorm);
  requireFinitePositive("targetCollarPx", targetCollarPx);

  if (collarWidthNorm > 1) {
    throw new Error(
      `[pose-normalise] collarWidthNorm must be a 0..1 fraction of the pose image width, got ${collarWidthNorm}. ` +
        "It looks like a pixel value was passed instead of a normalised one.",
    );
  }

  const collarPx = collarWidthNorm * poseWidthPx;
  const scale = targetCollarPx / collarPx;

  const rawWidthPx = poseWidthPx * scale;
  const rawHeightPx = poseHeightPx * scale;

  // Checked BEFORE rounding: evenCeil() never returns less than 2 for a
  // positive input, so rounding first would hide a degenerate scale behind a
  // 2x2 image.
  if (rawWidthPx < 2 || rawHeightPx < 2) {
    throw new Error(
      `[pose-normalise] targetCollarPx=${targetCollarPx} scales this pose to ` +
        `${rawWidthPx.toFixed(3)}x${rawHeightPx.toFixed(3)}px, which is not renderable. ` +
        `(pose ${poseWidthPx}x${poseHeightPx}, collar ${collarWidthNorm} => ${collarPx.toFixed(2)}px, scale ${scale.toExponential(4)})`,
    );
  }

  const scaledWidthPx = evenCeil(rawWidthPx);
  const scaledHeightPx = evenCeil(rawHeightPx);

  return { scale, scaledWidthPx, scaledHeightPx };
}

/**
 * Horizontal offset of the scaled figure inside the output frame.
 *
 * Exhaustive over {@link PresenterSide} with a `never` check, so adding a side
 * to the union is a compile error here rather than a silent 0.
 */
function resolveSideOffsetPx(params: {
  side: PresenterSide;
  frameWidth: number;
  scaledWidthPx: number;
  sideInset: number;
}): number {
  const { side, frameWidth, scaledWidthPx, sideInset } = params;
  const insetPx = sideInset * frameWidth;
  switch (side) {
    case "left":
      return Math.round(insetPx);
    case "right":
      return Math.round(frameWidth - insetPx - scaledWidthPx);
    case "center":
      return Math.round((frameWidth - scaledWidthPx) / 2);
    default: {
      const exhaustive: never = side;
      throw new Error(
        `[pose-normalise] unhandled presenter side: ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * Resolve a calibrated pose + placement into output-frame pixel geometry.
 *
 * Returns the top-left of the scaled suit and the centre + base diameter of the
 * head mark. The head mark's own animation (the loudness pump) multiplies
 * `head.diameterPx`; this function does not know about the envelope.
 *
 * Mirroring is applied here: when `placement.mirror` is set the head hitbox is
 * reflected about the figure's own vertical centre line, so the mark still sits
 * on the collar rather than floating off the shoulder.
 *
 * @throws Error if the frame size or placement values are unusable, or if the
 *         resolved figure would land entirely outside the frame (a placement
 *         that renders nothing is a configuration bug, not an empty overlay).
 */
export function resolvePresenterLayout(params: {
  pose: CalibratedPose;
  placement: PresenterPlacement;
  frameWidth: number;
  frameHeight: number;
}): PresenterLayout {
  const { pose, placement, frameWidth, frameHeight } = params;

  requireFinitePositive("frameWidth", frameWidth);
  requireFinitePositive("frameHeight", frameHeight);
  if (!Number.isFinite(placement.bottomAnchor)) {
    throw new Error(
      `[pose-normalise] placement.bottomAnchor must be finite, got ${placement.bottomAnchor}.`,
    );
  }
  if (!Number.isFinite(placement.sideInset)) {
    throw new Error(
      `[pose-normalise] placement.sideInset must be finite, got ${placement.sideInset}.`,
    );
  }

  const { scale, scaledWidthPx, scaledHeightPx } = computePoseScale({
    poseSizePx: pose.size,
    collarWidthNorm: pose.hitboxes.collar.width,
    targetCollarPx: placement.targetCollarPx,
  });

  const mirrored = placement.mirror === true;

  const xPx = resolveSideOffsetPx({
    side: placement.side,
    frameWidth,
    scaledWidthPx,
    sideInset: placement.sideInset,
  });
  const yPx = Math.round(placement.bottomAnchor * frameHeight - scaledHeightPx);

  const fullyOffFrame =
    xPx + scaledWidthPx <= 0 ||
    xPx >= frameWidth ||
    yPx + scaledHeightPx <= 0 ||
    yPx >= frameHeight;
  if (fullyOffFrame) {
    throw new Error(
      `[pose-normalise] pose "${pose.slug}" resolves to ${scaledWidthPx}x${scaledHeightPx} at ` +
        `(${xPx}, ${yPx}) in a ${frameWidth}x${frameHeight} frame — entirely outside it. ` +
        `Check placement { side: "${placement.side}", sideInset: ${placement.sideInset}, ` +
        `bottomAnchor: ${placement.bottomAnchor}, targetCollarPx: ${placement.targetCollarPx} }.`,
    );
  }

  const headNormX = mirrored
    ? 1 - pose.hitboxes.head.center.x
    : pose.hitboxes.head.center.x;

  return {
    scale,
    suit: {
      widthPx: scaledWidthPx,
      heightPx: scaledHeightPx,
      xPx,
      yPx,
      mirrored,
    },
    head: {
      centreXPx: xPx + headNormX * scaledWidthPx,
      centreYPx: yPx + pose.hitboxes.head.center.y * scaledHeightPx,
      // radius is a fraction of the pose image WIDTH (contracts §HeadHitboxSchema),
      // so it scales with the scaled width, keeping the mark circular.
      diameterPx: 2 * pose.hitboxes.head.radius * scaledWidthPx,
    },
  };
}
