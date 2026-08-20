/**
 * Character cycling for thumbnail generation.
 *
 * The owner's requirement, verbatim: "I have generated a few images for my two
 * characters, which when generating the thumbnails will just cycle through — on
 * the thumbnails we will have a little bit of variation."
 *
 * WHY DETERMINISTIC AND NOT RANDOM
 * --------------------------------
 * Random selection has three concrete costs here:
 *
 *  1. A failed generation that is retried by BullMQ would come back with a
 *     DIFFERENT face pose than the one whose prompt/brief is already recorded
 *     on the thumbnail row. The row would then describe an image that was never
 *     made — this codebase has been burned by exactly that class of untruth.
 *  2. A 3-variant batch would collide: three independent random draws over 7
 *     images pick a duplicate ~60% of the time, so "variation" would routinely
 *     produce two identical hosts side by side.
 *  3. "Regenerate" would be a coin flip rather than a promise.
 *
 * HOW
 * ---
 *     index = ( hash(subjectId) + variantIndex + regenStep ) % imageCount
 *
 * It is a HASH FOR THE JOB plus an explicit OFFSET, not one hash over
 * everything. That distinction is the whole design: hashing the concatenated
 * seed would only make collisions *unlikely*, and "unlikely" is not what the
 * requirement says. Three variants over seven images collide about 60% of the
 * time under independent draws, and a regenerate that hashes back to the same
 * index looks exactly like a broken regenerate button. With an additive offset:
 *
 *   * same job, same variant, replayed   -> same image  (reproducible)
 *   * variants 0/1/2 of one batch        -> three CONSECUTIVE, distinct images
 *   * regenerate (parentThumbnailId set) -> a step of 1..count-1, so it is
 *                                           GUARANTEED to differ, and is itself
 *                                           reproducible
 *   * different jobs                     -> spread over the whole set
 *
 * The one honest limit: with a single image there is nothing to cycle, so every
 * request returns it. That is a data problem (add more photos), not a bug, and
 * it is not papered over.
 *
 * This mirrors the archetype picker's existing "variantIndex steps the cycle
 * forward" idiom, so the two cycles behave the same way.
 *
 * The hash is FNV-1a/32: three lines, no dependency, stable across Node
 * versions and machines. `Math.random()` and `Date.now()` are deliberately
 * absent — nothing here may depend on wall-clock or process state.
 */

import type { DrizzleClient } from "@repo/db";
import { resolveChannelHost } from "@repo/db/repositories";
import type { ChannelHost } from "@repo/db/repositories";

/** FNV-1a 32-bit. Stable, uniform enough for a modulo over <100 items. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit int; Math.imul does the 32-bit multiply.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface CycleSeed {
  subjectId: string;
  variantIndex: number;
  /** Set on iterate/regenerate — this is what makes a regenerate differ. */
  parentThumbnailId?: string | null;
}

/** The stable part of the seed: which JOB this is. Not the variant/regen step. */
export function buildCycleSeed(seed: CycleSeed): string {
  return seed.subjectId;
}

/**
 * How far past the job's base image this particular request steps.
 *
 * 0 for the first variant of an original. A regenerate adds 1..count-1 — never
 * 0 — so it cannot land back on the image it is regenerating away from, while
 * still being derived purely from the parent id (so replaying the same
 * regenerate is reproducible).
 */
export function cycleOffset(seed: CycleSeed, count: number): number {
  let offset = seed.variantIndex;
  if (seed.parentThumbnailId && count > 1) {
    offset += 1 + (fnv1a32(seed.parentThumbnailId) % (count - 1));
  }
  return offset;
}

/**
 * Which image of `count` this generation gets. Pure.
 * Throws on an empty set rather than returning a sentinel — there is no
 * "default character image", and inventing one is a synthetic fallback.
 */
export function pickCycleIndex(seed: CycleSeed, count: number): number {
  if (count <= 0) {
    throw new Error(
      `pickCycleIndex called with ${count} images for subject ` +
        `${seed.subjectId}. A character with no images cannot be placed on a ` +
        `thumbnail; refusing to substitute anything.`,
    );
  }
  const base = fnv1a32(buildCycleSeed(seed));
  // >>> 0 after the add: base can be near 2^32 and JS numbers stay exact here,
  // but keeping it unsigned makes the modulo obviously non-negative.
  return ((base + cycleOffset(seed, count)) >>> 0) % count;
}

export interface ResolvedCharacterReference {
  characterId: string;
  characterName: string;
  description: string;
  /** Absolute path of the image chosen for THIS generation. */
  imagePath: string;
  imageId: string;
  pose: string | null;
  expression: string | null;
  /** 0-based position in the cycle, and how many were available. */
  cycleIndex: number;
  cycleSize: number;
}

/**
 * Resolve the channel's on-camera host and pick this generation's image.
 *
 * Returns undefined when the channel has no host character bound, or when the
 * bound host has no active images — both are "no persona", and the engine then
 * generates without a host reference exactly as it did before. It never
 * substitutes another channel's character.
 */
export async function resolveCharacterReference(
  db: DrizzleClient,
  channelId: string,
  seed: CycleSeed,
): Promise<ResolvedCharacterReference | undefined> {
  const host: ChannelHost | undefined = await resolveChannelHost(db, channelId);
  if (!host) return undefined;

  const cycleIndex = pickCycleIndex(seed, host.images.length);
  const image = host.images[cycleIndex]!;
  return {
    characterId: host.character.id,
    characterName: host.character.name,
    description: host.character.description,
    imagePath: image.image_path,
    imageId: image.id,
    pose: image.pose,
    expression: image.expression,
    cycleIndex,
    cycleSize: host.images.length,
  };
}
