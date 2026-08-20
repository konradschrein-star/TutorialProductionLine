import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { stockClips, stockClipUses } from "../schema/stock-clips.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

export interface StockClipWithEmbedding {
  id: string;
  video_path: string;
  prompt: string;
  duration_sec: string;
  embedding: number[];
}

export type NewStockClip = typeof stockClips.$inferInsert;
export type StockClip = typeof stockClips.$inferSelect;

export interface StockClipBootstrapSpec {
  prompt: string;
  vibe_tag?: string | null;
  origin?: "bootstrap" | "hook_writeback";
}

/**
 * Create a stock_clips row in 'queued' state, before the bootstrap
 * worker has actually generated the MP4.
 */
export async function reserveStockClip(
  spec: StockClipBootstrapSpec,
  tx?: Transaction,
): Promise<StockClip> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .insert(stockClips)
    .values({
      video_path: "",
      duration_sec: "0",
      prompt: spec.prompt,
      vibe_tag: spec.vibe_tag ?? null,
      origin: spec.origin ?? "bootstrap",
      status: "queued",
    })
    .returning();
  if (!row) throw new Error("reserveStockClip insert returned no row");
  return row;
}

export async function markStockClipGenerating(
  id: string,
  veoJobId: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(stockClips)
    .set({ status: "generating", veo_job_id: veoJobId })
    .where(eq(stockClips.id, id));
}

export async function markStockClipReady(
  id: string,
  videoPath: string,
  durationSec: number,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(stockClips)
    .set({
      status: "ready",
      video_path: videoPath,
      duration_sec: durationSec.toFixed(3),
    })
    .where(eq(stockClips.id, id));
}

export async function markStockClipFailed(
  id: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(stockClips)
    .set({ status: "failed" })
    .where(eq(stockClips.id, id));
}

/**
 * Insert a ready-to-go stock clip in one shot — used by the hook
 * writeback path where the MP4 already exists on disk.
 */
export async function insertReadyStockClip(
  spec: {
    video_path: string;
    duration_sec: number;
    prompt: string;
    vibe_tag?: string | null;
    origin: "bootstrap" | "hook_writeback";
    veo_job_id?: string | null;
  },
  tx?: Transaction,
): Promise<StockClip> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .insert(stockClips)
    .values({
      video_path: spec.video_path,
      duration_sec: spec.duration_sec.toFixed(3),
      prompt: spec.prompt,
      vibe_tag: spec.vibe_tag ?? null,
      origin: spec.origin,
      veo_job_id: spec.veo_job_id ?? null,
      status: "ready",
    })
    .returning();
  if (!row) throw new Error("insertReadyStockClip returned no row");
  return row;
}

export async function countReadyStockClips(tx?: Transaction): Promise<number> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(stockClips)
    .where(eq(stockClips.status, "ready"));
  return row?.c ?? 0;
}

/**
 * Pick N stock clips for a video. Honours within-video cooldown of
 * COOLDOWN slots: the picker maintains a sliding window of the last
 * COOLDOWN clip IDs and never picks one in that window.
 *
 * Bias: prefer clips with NULL last_used_at first, then oldest
 * last_used_at — keeps the library churning evenly.
 *
 * Returns N rows (or fewer if the ready pool can't honour the
 * cooldown, in which case we relax the cooldown and warn).
 */
export async function pickStockClipChain(
  n: number,
  opts: { cooldown?: number } = {},
  tx?: Transaction,
): Promise<StockClip[]> {
  const COOLDOWN = opts.cooldown ?? 10;
  const db = getDbOrTx(tx);

  // Pull the whole ready pool ordered by least-recently-used.
  // 2 000–5 000 rows is tiny; no need for cursor / pagination.
  const pool = await db
    .select()
    .from(stockClips)
    .where(eq(stockClips.status, "ready"))
    .orderBy(sql`${stockClips.last_used_at} ASC NULLS FIRST`);

  if (pool.length === 0) return [];

  const chain: StockClip[] = [];
  const window: string[] = [];
  // Shuffle within "same priority tier" so two adjacent renders don't pick
  // the exact same opening sequence. We do this by Fisher-Yates over the
  // pool BEFORE picking — the LRU order still dominates because we walk
  // start-to-end, but within ties order is randomised per call.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  let cursor = 0;
  while (chain.length < n) {
    let picked: StockClip | null = null;
    // Walk the shuffled pool from cursor looking for a clip not in the
    // cooldown window.
    for (let step = 0; step < shuffled.length; step++) {
      const idx = (cursor + step) % shuffled.length;
      const candidate = shuffled[idx]!;
      if (!window.includes(candidate.id)) {
        picked = candidate;
        cursor = (idx + 1) % shuffled.length;
        break;
      }
    }
    if (!picked) {
      // Pool too small to honour cooldown for the remaining slots — drop
      // the oldest entry from the window and try again. This degrades
      // gracefully: cooldown shrinks rather than the chain truncating.
      if (window.length === 0) break; // truly nothing left
      window.shift();
      continue;
    }
    chain.push(picked);
    window.push(picked.id);
    if (window.length > COOLDOWN) window.shift();
  }

  return chain;
}

/**
 * Mark a batch of clips as used right now, and persist the per-job
 * use rows for traceability.
 */
export async function recordStockClipChainUse(
  jobId: string,
  picks: { stockClipId: string; position: number }[],
  tx?: Transaction,
): Promise<void> {
  if (picks.length === 0) return;
  const db = getDbOrTx(tx);
  await db.insert(stockClipUses).values(
    picks.map((p) => ({
      job_id: jobId,
      stock_clip_id: p.stockClipId,
      position: p.position.toString(),
    })),
  );
  await db
    .update(stockClips)
    .set({ last_used_at: new Date() })
    .where(
      inArray(
        stockClips.id,
        picks.map((p) => p.stockClipId),
      ),
    );
}

/**
 * Store a 768-dim Gemini text-embedding-004 vector for a clip.
 * Uses raw SQL because Drizzle has no native halfvec type support.
 */
export async function storeClipEmbedding(
  id: string,
  vec: number[],
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  const vecStr = `[${vec.join(",")}]`;
  await db.execute(
    sql`UPDATE stock_clips SET embedding = ${vecStr}::halfvec(384) WHERE id = ${id}::uuid`,
  );
}

/**
 * Load all ready clips that have a stored embedding.
 * Returns parsed embedding as number[] (halfvec text format "[a,b,...]"
 * is valid JSON so JSON.parse handles the conversion).
 */
export async function loadReadyEmbeddings(
  tx?: Transaction,
): Promise<StockClipWithEmbedding[]> {
  const db = getDbOrTx(tx);
  const rows = (await db.execute(sql`
    SELECT id, video_path, prompt, duration_sec, embedding::text AS emb
    FROM stock_clips
    WHERE status = 'ready' AND embedding IS NOT NULL
  `)) as unknown as Array<{
    id: string;
    video_path: string;
    prompt: string;
    duration_sec: string;
    emb: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    video_path: r.video_path,
    prompt: r.prompt,
    duration_sec: r.duration_sec,
    embedding: JSON.parse(r.emb) as number[],
  }));
}

/**
 * Drain the queued-stock-library pool — returns up to `limit` rows
 * still waiting for generation. The bootstrap worker calls this to
 * pull its next batch.
 */
export async function takeQueuedStockClips(
  limit: number,
  tx?: Transaction,
): Promise<StockClip[]> {
  const db = getDbOrTx(tx);
  return await db
    .select()
    .from(stockClips)
    .where(and(eq(stockClips.status, "queued"), isNull(stockClips.veo_job_id)))
    .limit(limit);
}
