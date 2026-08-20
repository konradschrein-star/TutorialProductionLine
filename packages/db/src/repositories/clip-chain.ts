/**
 * Clip Chain Repository
 *
 * Builds multi-clip runs to cover a target duration when a single candidate
 * is too short. Two modes:
 *
 *  chainContinuous — walks prev_clip_id / next_clip_id outward from the seed
 *  within the same source_video_id. Use when TransNetV2 over-segmented the
 *  scene (flash frames, fast action) and adjacent clips together rebuild the
 *  original shot. NOT useful when the seed isn't representative — it just
 *  produces more of the same shot.
 *
 *  chainThematic — picks N visually compatible clips from a provided
 *  candidate pool, drawn from different source_video_ids. Compatible means:
 *    - same clip_type (no animation mid-live-action montage)
 *    - motion_level within one step
 *    - matching lighting_style and color_temperature
 *  Use when the seed is the right vibe but we want montage variety.
 *
 *  chainForShot — picks the mode for a given shot. Continuous if the seed's
 *  next-adjacent shares its narrative_type / dominant_mood; thematic
 *  otherwise.
 */

import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import { clips } from "../schema/clip-library.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChainClipRow {
  id: string;
  source_video_id: string;
  start_ms: number;
  end_ms: number;
  clip_type: string | null;
  motion_level: string | null;
  lighting_style: string | null;
  color_temperature: string | null;
  dominant_mood: string | null;
  narrative_type: string | null;
}

export interface ChainResult {
  mode: "continuous" | "thematic";
  clips: ChainClipRow[];
  total_duration_ms: number;
}

const MOTION_ORDER: Record<string, number> = {
  static: 0,
  slow: 1,
  medium: 2,
  fast: 3,
  chaotic: 4,
};

function within(
  orderMap: Record<string, number>,
  a: string,
  b: string,
  span: number,
): boolean {
  const ai = orderMap[a];
  const bi = orderMap[b];
  if (ai == null || bi == null) return true; // unknown = permissive
  return Math.abs(ai - bi) <= span;
}

function rowDurationMs(c: ChainClipRow): number {
  return c.end_ms - c.start_ms;
}

// ── Continuous chain (walks prev/next within source) ────────────────────────

/**
 * Walk forward (and optionally backward) from `seedId` along prev/next pointers
 * within the same source_video_id until the accumulated duration meets
 * `targetMs` or no more neighbours exist.
 *
 * Returns clips in playback order. The seed is always included.
 */
export async function chainContinuous(
  db: DrizzleClient,
  seedId: string,
  targetMs: number,
): Promise<ChainResult> {
  const seed = await loadChainClip(db, seedId);
  if (!seed) return { mode: "continuous", clips: [], total_duration_ms: 0 };

  const collected: ChainClipRow[] = [seed];
  let total = rowDurationMs(seed);

  // Walk forward first — most natural for B-roll flow.
  let cursor: ChainClipRow | null = seed;
  while (total < targetMs) {
    const nextId = await neighbourId(db, cursor.id, "next");
    if (!nextId) break;
    const next = await loadChainClip(db, nextId);
    if (!next || next.source_video_id !== seed.source_video_id) break;
    collected.push(next);
    total += rowDurationMs(next);
    cursor = next;
  }

  // Then walk backward if still short.
  cursor = seed;
  while (total < targetMs) {
    const prevId = await neighbourId(db, cursor.id, "prev");
    if (!prevId) break;
    const prev = await loadChainClip(db, prevId);
    if (!prev || prev.source_video_id !== seed.source_video_id) break;
    collected.unshift(prev);
    total += rowDurationMs(prev);
    cursor = prev;
  }

  return { mode: "continuous", clips: collected, total_duration_ms: total };
}

// ── Thematic chain (montage of compatible clips from candidate pool) ────────

/**
 * Build a montage from the candidate pool. Compatibility filter is strict —
 * different sources, same clip_type, motion within one step, matching
 * lighting/color. Within compatible candidates we preserve the pool's order
 * (which is the search result's RRF ranking, so most-relevant first).
 */
export async function chainThematic(
  db: DrizzleClient,
  seedId: string,
  targetMs: number,
  candidatePool: string[],
): Promise<ChainResult> {
  const seed = await loadChainClip(db, seedId);
  if (!seed) return { mode: "thematic", clips: [], total_duration_ms: 0 };

  const pool = await loadChainClips(db, candidatePool);

  const collected: ChainClipRow[] = [seed];
  const usedSources = new Set<string>([seed.source_video_id]);
  let total = rowDurationMs(seed);

  for (const c of pool) {
    if (c.id === seed.id) continue;
    if (usedSources.has(c.source_video_id)) continue;
    if (seed.clip_type && c.clip_type && seed.clip_type !== c.clip_type)
      continue;
    if (
      seed.motion_level &&
      c.motion_level &&
      !within(MOTION_ORDER, seed.motion_level, c.motion_level, 1)
    )
      continue;
    if (
      seed.lighting_style &&
      c.lighting_style &&
      seed.lighting_style !== c.lighting_style
    )
      continue;
    if (
      seed.color_temperature &&
      c.color_temperature &&
      seed.color_temperature !== c.color_temperature
    )
      continue;

    collected.push(c);
    usedSources.add(c.source_video_id);
    total += rowDurationMs(c);
    if (total >= targetMs) break;
  }

  return { mode: "thematic", clips: collected, total_duration_ms: total };
}

// ── Mode picker ──────────────────────────────────────────────────────────────

/**
 * Pick continuous or thematic based on whether the seed's next-adjacent clip
 * shares its narrative_type AND dominant_mood. Strong continuity → continuous
 * (rebuild the over-segmented scene). Otherwise thematic (montage of
 * compatible clips from the pool).
 *
 * Always falls back to thematic when the seed has no adjacency.
 */
export async function chainForShot(
  db: DrizzleClient,
  seedId: string,
  targetMs: number,
  candidatePool: string[],
): Promise<ChainResult> {
  const seed = await loadChainClip(db, seedId);
  if (!seed) return { mode: "thematic", clips: [], total_duration_ms: 0 };

  // Already long enough — single-clip result.
  if (rowDurationMs(seed) >= targetMs) {
    return {
      mode: "continuous",
      clips: [seed],
      total_duration_ms: rowDurationMs(seed),
    };
  }

  const nextId = await neighbourId(db, seedId, "next");
  if (nextId) {
    const next = await loadChainClip(db, nextId);
    if (
      next &&
      next.source_video_id === seed.source_video_id &&
      next.narrative_type &&
      seed.narrative_type &&
      next.narrative_type === seed.narrative_type &&
      next.dominant_mood === seed.dominant_mood
    ) {
      return chainContinuous(db, seedId, targetMs);
    }
  }
  return chainThematic(db, seedId, targetMs, candidatePool);
}

// ── Loaders ──────────────────────────────────────────────────────────────────

async function loadChainClip(
  db: DrizzleClient,
  id: string,
): Promise<ChainClipRow | null> {
  const [row] = await db
    .select({
      id: clips.id,
      source_video_id: clips.source_video_id,
      start_ms: clips.start_ms,
      end_ms: clips.end_ms,
      clip_type: clips.clip_type,
      motion_level: clips.motion_level,
      lighting_style: clips.lighting_style,
      color_temperature: clips.color_temperature,
      dominant_mood: clips.dominant_mood,
      narrative_type: clips.narrative_type,
    })
    .from(clips)
    .where(eq(clips.id, id))
    .limit(1);
  return row ?? null;
}

async function loadChainClips(
  db: DrizzleClient,
  ids: string[],
): Promise<ChainClipRow[]> {
  if (ids.length === 0) return [];
  // Preserves caller's order so RRF ranking carries through to chain choices.
  const rows = (await db.execute(sql`
    SELECT
      id, source_video_id, start_ms, end_ms,
      clip_type, motion_level, lighting_style, color_temperature,
      dominant_mood, narrative_type
    FROM clips
    WHERE id = ANY(${ids}::uuid[])
  `)) as unknown as ChainClipRow[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: ChainClipRow[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }
  return ordered;
}

async function neighbourId(
  db: DrizzleClient,
  clipId: string,
  direction: "prev" | "next",
): Promise<string | null> {
  const col = direction === "next" ? clips.next_clip_id : clips.prev_clip_id;
  const [row] = await db
    .select({ neighbour: col })
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  return row?.neighbour ?? null;
}
