/**
 * Seed values for a hitbox the operator is about to author.
 *
 * A seed is NOT a calibration. It exists because a drag needs something to grab,
 * and it is deliberately geometrically neutral — centred, full-frame, pointing
 * along +x — so it is obviously wrong on sight rather than plausibly wrong. Every
 * seeded hitbox is drawn dashed and labelled "(seeded)" on the canvas, and the
 * Studio refuses to mark a pose calibrated while any seed remains untouched.
 *
 * That is what keeps this the right side of design §8 rule 2 ("no guessing a
 * head position"): the pose file never receives a value the operator did not
 * place, because a pose containing only seeds cannot reach
 * `anchor_status: "calibrated"`, and an uncalibrated pose is rejected by
 * `CalibratedPoseSchema` in every render path.
 */

import type {
  CollarHitbox,
  HeadHitbox,
  NormPoint,
  NormRect,
  NormVector,
} from "@repo/contracts";

import type { HitboxDraft, HitboxName } from "./geometry";

/** Head: centre of the image, a tenth of its width across. */
export const SEED_HEAD: HeadHitbox = {
  center: { x: 0.5, y: 0.5 },
  radius: 0.1,
};

/** Collar: 15% of the image width, which is wrong for every one of the 16 poses. */
export const SEED_COLLAR: CollarHitbox = { width: 0.15 };

/** Pointing origin: centre of the image. */
export const SEED_POINT_ORIGIN: NormPoint = { x: 0.5, y: 0.5 };

/** Pointing direction: straight right, in pose-pixel space. */
export const SEED_POINT_DIRECTION: NormVector = { x: 1, y: 0 };

/** Safe region: the image inset by 5% on every side. */
export const SEED_SAFE_REGION: NormRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

/** Crop: the whole image. */
export const SEED_CROP: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Seed one hitbox of a draft.
 *
 * @returns A new draft with `name` seeded. Never mutates the input.
 * @throws Error on an unknown hitbox name (exhaustive over {@link HitboxName}).
 */
export function seedHitbox(draft: HitboxDraft, name: HitboxName): HitboxDraft {
  switch (name) {
    case "head":
      return { ...draft, head: SEED_HEAD };
    case "collar":
      return { ...draft, collar: SEED_COLLAR };
    case "pointOrigin":
      return { ...draft, pointOrigin: SEED_POINT_ORIGIN };
    case "pointDirection":
      return { ...draft, pointDirection: SEED_POINT_DIRECTION };
    case "safeRegion":
      return { ...draft, safeRegion: SEED_SAFE_REGION };
    case "crop":
      return { ...draft, crop: SEED_CROP };
    default: {
      const exhaustive: never = name;
      throw new Error(`[studio-seeds] unknown hitbox "${String(exhaustive)}".`);
    }
  }
}

/** Clear one hitbox back to unauthored. */
export function clearHitbox(draft: HitboxDraft, name: HitboxName): HitboxDraft {
  return { ...draft, [name]: null };
}
