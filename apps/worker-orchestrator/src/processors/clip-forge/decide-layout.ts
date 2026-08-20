import type { HitboxV2Person, HitboxV2Result } from "./detect-all-hitboxes.js";

/**
 * Clip Forge — layout decider V2.
 *
 * Takes the V2 detection (persons + their faces, on the full frame) and
 * decides which of four layouts to render, plus computes the exact crop
 * regions per the user's spec:
 *
 *   fullscreen-single                — 1 fullscreen-sized speaker, alone on
 *                                       the source frame. Scale to 9:16, body
 *                                       fully inside, no upscale past native.
 *
 *   facecam-top-screen-bottom        — 1 speaker who lives inside a small
 *                                       facecam panel (screen capture stream
 *                                       with one face cam corner overlay).
 *                                       Top half = the facecam panel,
 *                                       bottom half = the rest of the screen.
 *                                       (Less common — fires when the only
 *                                       speaker is in a small box, which means
 *                                       it's a screen-share style source.)
 *
 *   stacked-facecams                 — 2 speakers, both small enough to be
 *                                       facecams. Stack their panels top/bottom.
 *
 *   top-fullscreen-bottom-facecam    — 1 big speaker + 1 small speaker. Big
 *                                       one fills the top, small one (facecam)
 *                                       fills the bottom. The fullscreen crop
 *                                       MUST exclude the facecam pixels.
 *                                       (This is the Marck × Olli case.)
 *
 * Threshold for "small enough to be a facecam": body area < 25% of frame area.
 * Threshold for "fullscreen": body area > 40% of frame area.
 */

export type LayoutKind =
  | "fullscreen-single"
  | "facecam-top-screen-bottom"
  | "stacked-facecams"
  | "top-fullscreen-bottom-facecam";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutDecision {
  kind: LayoutKind;
  reason: string;
  /** Source-frame crop for the fullscreen speaker (single or top). */
  fullscreen?: { crop: Box; faceBox: Box };
  /** Source-frame crop for the facecam speaker (bottom or only). */
  facecam?: { crop: Box; faceBox: Box };
  /** Source-frame crop for the screen content (facecam-top-screen-bottom). */
  screen?: { crop: Box };
  /** Both panels for stacked-facecams. */
  topFacecam?: { crop: Box; faceBox: Box };
  bottomFacecam?: { crop: Box; faceBox: Box };
}

const FACECAM_AREA_FRAC = 0.18;
const FULLSCREEN_AREA_FRAC = 0.25;
/** Padding around a body box when building its facecam crop region. */
const FACECAM_PAD = 0.08;
/** Minimum sample-cluster size before we trust a detected person. */
const MIN_CLUSTER = 6;
/** Minimum % of frame area a real speaker should cover (filter picture frames). */
const MIN_AREA_FRAC = 0.04;
/** Drop merged-blob false positives: a person box A is dropped when another
 * person B has ≥ this fraction of A's pixels inside A AND has higher cluster
 * size. Idea: B is the "real" tighter detection of part of A. */
const CONTAINS_DROP_FRAC = 0.55;

export function decideLayout(detection: HitboxV2Result): LayoutDecision {
  const frame = { w: detection.frame_w, h: detection.frame_h };
  const frameArea = frame.w * frame.h;
  const persons = filterDetections(detection.persons, frameArea);

  // No detection at all → fail loudly so the caller skips variant generation.
  if (persons.length === 0) {
    return {
      kind: "fullscreen-single",
      reason: "no persons detected — fallback",
    };
  }

  // ── Case A: exactly one speaker ────────────────────────────────────────
  if (persons.length === 1) {
    const p = persons[0];
    const areaFrac = (p.person_box.w * p.person_box.h) / frameArea;
    if (areaFrac >= FULLSCREEN_AREA_FRAC) {
      return {
        kind: "fullscreen-single",
        reason: `1 speaker, body fills ${(areaFrac * 100).toFixed(0)}% of frame`,
        fullscreen: {
          crop: clampBox(buildFullscreenCrop(p, frame, []), frame),
          faceBox: p.face_box ?? deriveFaceFromPerson(p),
        },
      };
    }
    // Small-only single speaker → looks like a facecam over a screen capture.
    return {
      kind: "facecam-top-screen-bottom",
      reason: `1 small speaker (${(areaFrac * 100).toFixed(0)}% area) — treat as facecam over screen capture`,
      facecam: {
        crop: clampBox(buildFacecamCrop(p, frame), frame),
        faceBox: p.face_box ?? deriveFaceFromPerson(p),
      },
      screen: {
        crop: oppositeRect(frame, buildFacecamCrop(p, frame)),
      },
    };
  }

  // ── 2+ speakers ────────────────────────────────────────────────────────
  // Take the two biggest. We never split into 3+ panels.
  const sorted = [...persons].sort(
    (a, b) => b.person_box.w * b.person_box.h - a.person_box.w * a.person_box.h,
  );
  const a = sorted[0];
  const b = sorted[1];
  const aArea = a.person_box.w * a.person_box.h;
  const bArea = b.person_box.w * b.person_box.h;
  const aFrac = aArea / frameArea;
  const bFrac = bArea / frameArea;

  // Case B: both small → both facecams → stacked
  if (aFrac < FACECAM_AREA_FRAC && bFrac < FACECAM_AREA_FRAC) {
    return {
      kind: "stacked-facecams",
      reason: `2 small speakers (${(aFrac * 100).toFixed(0)}% + ${(bFrac * 100).toFixed(0)}%) — stacked facecams`,
      topFacecam: {
        crop: clampBox(buildFacecamCrop(a, frame), frame),
        faceBox: a.face_box ?? deriveFaceFromPerson(a),
      },
      bottomFacecam: {
        crop: clampBox(buildFacecamCrop(b, frame), frame),
        faceBox: b.face_box ?? deriveFaceFromPerson(b),
      },
    };
  }

  // Case C: one big + one small → fullscreen + facecam stacked
  if (aFrac >= FULLSCREEN_AREA_FRAC && bFrac < FACECAM_AREA_FRAC) {
    const facecamRegion = clampBox(buildFacecamCrop(b, frame), frame);
    return {
      kind: "top-fullscreen-bottom-facecam",
      reason: `1 fullscreen (${(aFrac * 100).toFixed(0)}%) + 1 facecam (${(bFrac * 100).toFixed(0)}%)`,
      fullscreen: {
        crop: clampBox(buildFullscreenCrop(a, frame, [facecamRegion]), frame),
        faceBox: a.face_box ?? deriveFaceFromPerson(a),
      },
      facecam: {
        crop: facecamRegion,
        faceBox: b.face_box ?? deriveFaceFromPerson(b),
      },
    };
  }

  // Case D fallback: two big speakers (unusual). Treat as stacked facecams.
  return {
    kind: "stacked-facecams",
    reason: `2 speakers (${(aFrac * 100).toFixed(0)}% + ${(bFrac * 100).toFixed(0)}%) — fallback to stacked`,
    topFacecam: {
      crop: clampBox(buildFacecamCrop(a, frame), frame),
      faceBox: a.face_box ?? deriveFaceFromPerson(a),
    },
    bottomFacecam: {
      crop: clampBox(buildFacecamCrop(b, frame), frame),
      faceBox: b.face_box ?? deriveFaceFromPerson(b),
    },
  };
}

/**
 * Build a facecam-style crop around one speaker's body box with a little
 * padding. This becomes the rectangular region shown in a stacked-facecams or
 * the bottom panel of top-fullscreen-bottom-facecam.
 */
function buildFacecamCrop(
  p: HitboxV2Person,
  frame: { w: number; h: number },
): Box {
  const pad = FACECAM_PAD;
  const x = p.person_box.x - p.person_box.w * pad;
  const y = p.person_box.y - p.person_box.h * pad * 1.5;
  const w = p.person_box.w * (1 + 2 * pad);
  const h = p.person_box.h * (1 + 2.5 * pad);
  return clampBox({ x, y, w, h }, frame);
}

/**
 * Build a fullscreen crop around the main speaker that EXCLUDES every region
 * in `forbidden` (other speakers' facecam panels). We pick the largest sub-
 * rectangle of the source frame that contains the speaker's body fully and
 * has zero overlap with any forbidden rect.
 *
 * Algorithm: start from the full source frame. For each forbidden rect,
 * carve away the smallest possible side so the survivor still contains the
 * speaker's body box. We pick the side (top/bottom/left/right) whose cut
 * loses the least canvas area while keeping the body inside.
 */
function buildFullscreenCrop(
  speaker: HitboxV2Person,
  frame: { w: number; h: number },
  forbidden: Box[],
): Box {
  let crop: Box = { x: 0, y: 0, w: frame.w, h: frame.h };
  const body = speaker.person_box;

  for (const f of forbidden) {
    if (!overlaps(crop, f)) continue;
    crop = carveAway(crop, f, body) ?? crop;
  }
  return crop;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Given a crop that overlaps a forbidden rect AND must keep a body box inside,
 * return the largest of the four "carve one side off" candidates that still
 * contains body and removes the overlap. Returns null if no carving keeps the
 * body inside (caller falls back to the un-carved crop, accepting overlap).
 */
function carveAway(crop: Box, forbid: Box, body: Box): Box | null {
  const candidates: Box[] = [];
  // Carve away the LEFT strip of crop up to forbid's right edge.
  const cutFromLeft = forbid.x + forbid.w;
  if (cutFromLeft > crop.x && cutFromLeft < crop.x + crop.w) {
    candidates.push({
      x: cutFromLeft,
      y: crop.y,
      w: crop.x + crop.w - cutFromLeft,
      h: crop.h,
    });
  }
  // Carve away the RIGHT strip from forbid's left edge.
  const cutFromRight = forbid.x;
  if (cutFromRight > crop.x && cutFromRight < crop.x + crop.w) {
    candidates.push({
      x: crop.x,
      y: crop.y,
      w: cutFromRight - crop.x,
      h: crop.h,
    });
  }
  // Carve away the TOP strip up to forbid's bottom.
  const cutFromTop = forbid.y + forbid.h;
  if (cutFromTop > crop.y && cutFromTop < crop.y + crop.h) {
    candidates.push({
      x: crop.x,
      y: cutFromTop,
      w: crop.w,
      h: crop.y + crop.h - cutFromTop,
    });
  }
  // Carve away the BOTTOM strip from forbid's top.
  const cutFromBottom = forbid.y;
  if (cutFromBottom > crop.y && cutFromBottom < crop.y + crop.h) {
    candidates.push({
      x: crop.x,
      y: crop.y,
      w: crop.w,
      h: cutFromBottom - crop.y,
    });
  }
  // Keep only candidates that fully contain the body box.
  const viable = candidates.filter(
    (c) =>
      body.x >= c.x &&
      body.y >= c.y &&
      body.x + body.w <= c.x + c.w &&
      body.y + body.h <= c.y + c.h,
  );
  if (viable.length === 0) return null;
  // Of the viable ones, pick the one with the largest area.
  viable.sort((a, b) => b.w * b.h - a.w * a.h);
  return viable[0];
}

function oppositeRect(frame: { w: number; h: number }, b: Box): Box {
  // The bigger of the four sides outside `b`. For facecam-in-corner this picks
  // the larger remaining rectangle to show as "screen content".
  const candidates = [
    { x: 0, y: 0, w: b.x, h: frame.h },
    { x: b.x + b.w, y: 0, w: frame.w - (b.x + b.w), h: frame.h },
    { x: 0, y: 0, w: frame.w, h: b.y },
    { x: 0, y: b.y + b.h, w: frame.w, h: frame.h - (b.y + b.h) },
  ].filter((c) => c.w > 50 && c.h > 50);
  candidates.sort((a, b) => b.w * b.h - a.w * a.h);
  return candidates[0] ?? { x: 0, y: 0, w: frame.w, h: frame.h };
}

function clampBox(b: Box, frame: { w: number; h: number }): Box {
  const x = Math.max(0, Math.min(b.x, frame.w - 1));
  const y = Math.max(0, Math.min(b.y, frame.h - 1));
  const w = Math.max(1, Math.min(b.w, frame.w - x));
  const h = Math.max(1, Math.min(b.h, frame.h - y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/**
 * Filter the raw V2 detection list:
 *   - Drop persons whose cluster_size is below MIN_CLUSTER (transient hits).
 *   - Drop persons whose area is below MIN_AREA_FRAC (likely static picture
 *     frames in the scene background).
 *   - Drop "merged-blob" persons that contain a higher-confidence smaller
 *     person mostly inside them (YOLO sometimes glues two real people into
 *     one giant box; the smaller, tighter detection of either person is the
 *     real signal).
 */
function filterDetections(
  persons: HitboxV2Person[],
  frameArea: number,
): HitboxV2Person[] {
  const passed = persons.filter(
    (p) =>
      p.cluster_size >= MIN_CLUSTER &&
      (p.person_box.w * p.person_box.h) / frameArea >= MIN_AREA_FRAC,
  );
  // Drop merged-blob persons.
  return passed.filter((a) => {
    for (const b of passed) {
      if (b === a) continue;
      const ax2 = a.person_box.x + a.person_box.w;
      const ay2 = a.person_box.y + a.person_box.h;
      const bx2 = b.person_box.x + b.person_box.w;
      const by2 = b.person_box.y + b.person_box.h;
      const ix1 = Math.max(a.person_box.x, b.person_box.x);
      const iy1 = Math.max(a.person_box.y, b.person_box.y);
      const ix2 = Math.min(ax2, bx2);
      const iy2 = Math.min(ay2, by2);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      const inter = iw * ih;
      const aArea = a.person_box.w * a.person_box.h;
      const bArea = b.person_box.w * b.person_box.h;
      // If b is smaller AND mostly inside a AND b has higher cluster signal,
      // drop a.
      if (
        bArea < aArea &&
        inter / aArea >= CONTAINS_DROP_FRAC &&
        b.cluster_size >= a.cluster_size
      ) {
        return false;
      }
    }
    return true;
  });
}

function deriveFaceFromPerson(p: HitboxV2Person): Box {
  // Fallback when YuNet didn't find a face: assume it sits in the upper 18% of
  // the person box, centered horizontally. Better than zero info for caption /
  // subtitle anchoring.
  return {
    x: Math.round(p.person_box.x + p.person_box.w * 0.32),
    y: Math.round(p.person_box.y + p.person_box.h * 0.05),
    w: Math.round(p.person_box.w * 0.36),
    h: Math.round(p.person_box.h * 0.22),
  };
}
