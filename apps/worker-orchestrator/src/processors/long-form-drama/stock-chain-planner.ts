/**
 * Plan a drama clip schedule using pre-rendered stock library clips.
 *
 * For STOCK_CHAIN_FULL: every slot pulls from the library. No hook.
 * For STOCK_CHAIN_HOOKED: slots in the body window pull from the
 *   library; the hook (first ~2 min) is handled by the existing
 *   prompt-gen + DIRECT_T2V pipeline and prepended outside this util.
 *
 * Slot boundaries snap to word-pauses so cuts never bisect a spoken
 * word. Target slot length is the library clip's actual duration
 * (~7.5 s native VEO), but we trim back to the nearest preceding pause
 * so the cut lands cleanly.
 *
 * Clip selection uses semantic matching when embeddings are available:
 * each slot's narration text is embedded with Gemini text-embedding-004
 * and matched against the clip prompt embeddings via cosine similarity
 * (dot product of L2-normalised vectors). A cooldown window prevents
 * the same clip from appearing within COOLDOWN slots of itself.
 * Falls back to random LRU when no embeddings exist in the pool.
 */

import { and, eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { dramaClips } from "@repo/db";
import {
  pickStockClipChain,
  recordStockClipChainUse,
  insertDramaClips,
  loadReadyEmbeddings,
  type DramaClipSpec,
  type StockClipWithEmbedding,
} from "@repo/db/repositories";
import { snapToPause, type WordTiming } from "./prompt-gen-utils.js";
import { embedBatch, dotProduct } from "../../utils/gemini-embed.js";

const DEFAULT_TARGET_SLOT_MS = 7500;
const MIN_SLOT_MS = 4000;

export interface PlanLibraryBodyOptions {
  jobId: string;
  clipLibraryId: string;
  /** Whole-script word timings (drives pause snapping + narration extraction). */
  wordTimings: WordTiming[];
  /** Where the library body should start (ms into the script). 0 for FULL. */
  startMs: number;
  /** Where the library body should end. End of TTS for everything. */
  endMs: number;
  /** clip_index offset — pass the next free index after the hook clips. */
  startIndex: number;
  /** Cooldown window — a clip won't reuse for at least this many slots. */
  cooldown?: number;
}

export interface PlannedLibraryBody {
  /** drama_clips specs to insert AFTER the hook clips, in order. */
  specs: DramaClipSpec[];
  /** Per-slot picked stock_clip rows so the caller can record use + set video_path. */
  picks: { clipIndex: number; stockClipId: string; videoPath: string }[];
}

/** Extract words spoken within [startMs, endMs]. */
function wordsInRange(
  timings: WordTiming[],
  startMs: number,
  endMs: number,
): string[] {
  return timings
    .filter((w) => w.start_ms >= startMs && w.end_ms <= endMs)
    .map((w) => w.word);
}

/**
 * Greedy nearest-neighbour clip assignment with cooldown.
 *
 * For each slot (in order) picks the highest-similarity clip from the
 * pool that isn't in the current cooldown window. Falls back to LRU
 * random order if all similar candidates are cooled down.
 */
function assignByEmbedding(
  slotEmbeddings: number[][],
  pool: StockClipWithEmbedding[],
  cooldown: number,
): StockClipWithEmbedding[] {
  const window: string[] = [];
  const chain: StockClipWithEmbedding[] = [];

  for (const queryVec of slotEmbeddings) {
    // Score each candidate against the query vector.
    const scored = pool.map((clip) => ({
      clip,
      score: dotProduct(queryVec, clip.embedding),
    }));
    // Sort descending by similarity.
    scored.sort((a, b) => b.score - a.score);

    // Pick the best candidate not in the cooldown window.
    let picked: StockClipWithEmbedding | null = null;
    for (const { clip } of scored) {
      if (!window.includes(clip.id)) {
        picked = clip;
        break;
      }
    }

    // If every high-similarity clip is cooled down, relax: pick the
    // least-recently-used candidate not in window (same degradation as
    // the random picker).
    if (!picked) {
      for (const clip of pool) {
        if (!window.includes(clip.id)) {
          picked = clip;
          break;
        }
      }
    }

    // Absolute last resort: pool is tiny, just loop.
    if (!picked) picked = pool[chain.length % pool.length]!;

    chain.push(picked);
    window.push(picked.id);
    if (window.length > cooldown) window.shift();
  }

  return chain;
}

/**
 * Walk the timeline from startMs to endMs, snapping each slot's end
 * to the nearest preceding word-pause. Each slot gets one library clip.
 */
export async function planLibraryBody(
  db: DrizzleClient,
  opts: PlanLibraryBodyOptions,
): Promise<PlannedLibraryBody> {
  // 1. Build slot boundaries from startMs → endMs, snapping each end
  //    to the nearest pause inside ±3s of the target.
  const boundaries: number[] = [Math.round(opts.startMs)];
  let cursor = opts.startMs;
  while (cursor + MIN_SLOT_MS < opts.endMs) {
    const target = cursor + DEFAULT_TARGET_SLOT_MS;
    const snapped = snapToPause(target, opts.wordTimings, 200, 2500);
    const slotEnd = snapped > cursor + MIN_SLOT_MS ? snapped : target;
    boundaries.push(Math.round(Math.min(slotEnd, opts.endMs)));
    cursor = slotEnd;
  }
  if (boundaries[boundaries.length - 1] !== Math.round(opts.endMs)) {
    boundaries.push(Math.round(opts.endMs));
  }
  const slotCount = boundaries.length - 1;
  if (slotCount === 0) {
    return { specs: [], picks: [] };
  }

  const cooldown = opts.cooldown ?? 10;

  // 2. Attempt semantic matching via embeddings.
  //    Load pool; if none have embeddings fall back to random.
  let chain: Array<{ id: string; video_path: string; prompt: string }>;

  const embeddedPool = await loadReadyEmbeddings(undefined);

  if (embeddedPool.length > 0) {
    // Extract narration text for each slot.
    const slotTexts = boundaries.slice(0, -1).map((startMs, i) => {
      const endMs = boundaries[i + 1]!;
      const words = wordsInRange(opts.wordTimings, startMs, endMs);
      // Use non-empty text; empty slots (pure silence) reuse the
      // nearest non-empty neighbour's text when we embed.
      return words.length > 0 ? words.join(" ") : "";
    });

    // Fill empty slot texts by borrowing the previous non-empty one.
    for (let i = 0; i < slotTexts.length; i++) {
      if (!slotTexts[i]) {
        slotTexts[i] = slotTexts[i - 1] ?? slotTexts[i + 1] ?? "drama scene";
      }
    }

    // Embed all slot texts in batched Gemini calls.
    const slotEmbeddings = await embedBatch(slotTexts);

    chain = assignByEmbedding(slotEmbeddings, embeddedPool, cooldown);
    console.log(
      JSON.stringify({
        level: "info",
        message: "stock-chain-planner: semantic matching",
        job_id: opts.jobId,
        slots: slotCount,
        pool_size: embeddedPool.length,
      }),
    );
  } else {
    // No embeddings yet — fall back to random LRU picker.
    const randomChain = await pickStockClipChain(
      slotCount,
      { cooldown },
      undefined,
    );
    if (randomChain.length === 0) {
      throw new Error(
        `Library has no ready clips for job ${opts.jobId} — bootstrap first`,
      );
    }
    chain = randomChain;
    console.log(
      JSON.stringify({
        level: "info",
        message: "stock-chain-planner: random fallback (no embeddings yet)",
        job_id: opts.jobId,
        slots: slotCount,
      }),
    );
  }

  // 3. Build drama_clips specs.
  const specs: DramaClipSpec[] = [];
  const picks: PlannedLibraryBody["picks"] = [];
  for (let i = 0; i < slotCount; i++) {
    const startMs = boundaries[i]!;
    const endMs = boundaries[i + 1]!;
    const stock = chain[i % chain.length]!;
    const clipIndex = opts.startIndex + i;
    specs.push({
      clipIndex,
      sectionType: "body",
      text: "",
      startMs,
      endMs,
      imagePrompt: stock.prompt,
      characterIds: [],
    });
    picks.push({
      clipIndex,
      stockClipId: stock.id,
      videoPath: stock.video_path,
    });
  }

  return { specs, picks };
}

/**
 * After inserting library-picked drama_clips, record stock_clip use
 * (touch last_used_at, populate stock_clip_uses) AND patch each new
 * drama_clip with the library clip's video_path so video-gen knows
 * the file already exists.
 */
export async function commitLibraryPicks(
  db: DrizzleClient,
  jobId: string,
  picks: PlannedLibraryBody["picks"],
): Promise<void> {
  if (picks.length === 0) return;
  await recordStockClipChainUse(
    jobId,
    picks.map((p, i) => ({ stockClipId: p.stockClipId, position: i })),
  );
  for (const p of picks) {
    await db
      .update(dramaClips)
      .set({
        video_path: p.videoPath,
        video_status: "done",
        image_status: "done",
      })
      .where(
        and(
          eq(dramaClips.job_id, jobId),
          eq(dramaClips.clip_index, p.clipIndex),
        ),
      );
  }
}

/**
 * Build a complete STOCK_CHAIN_FULL plan: pure library body from 0 →
 * end of TTS, no hook. Caller inserts the specs as-is.
 */
export async function planStockChainFull(
  db: DrizzleClient,
  jobId: string,
  clipLibraryId: string,
  wordTimings: WordTiming[],
): Promise<PlannedLibraryBody> {
  const totalDurationMs = wordTimings[wordTimings.length - 1]!.end_ms;
  return planLibraryBody(db, {
    jobId,
    clipLibraryId,
    wordTimings,
    startMs: 0,
    endMs: totalDurationMs,
    startIndex: 0,
  });
}

/**
 * Insert specs AND patch every row with its picked library video_path
 * + mark them ready. Used by both STOCK_CHAIN_FULL and the body of
 * STOCK_CHAIN_HOOKED.
 */
export async function commitPlan(
  db: DrizzleClient,
  jobId: string,
  plan: PlannedLibraryBody,
): Promise<void> {
  if (plan.specs.length === 0) return;
  await insertDramaClips(jobId, plan.specs);
  await commitLibraryPicks(db, jobId, plan.picks);
}
