import { eq, sql } from "drizzle-orm";
import { clipLibraries } from "../schema/clip-library.js";
import { stockClips } from "../schema/stock-clips.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

export type ClipLibrary = typeof clipLibraries.$inferSelect;
export type NewClipLibrary = typeof clipLibraries.$inferInsert;

export interface ClipLibraryWithCounts extends ClipLibrary {
  ready_count: number;
  queued_count: number;
  generating_count: number;
  failed_count: number;
  total_count: number;
  last_ready_at: Date | null;
}

export async function listClipLibraries(
  tx?: Transaction,
): Promise<ClipLibraryWithCounts[]> {
  const db = getDbOrTx(tx);
  const libs = await db
    .select()
    .from(clipLibraries)
    .orderBy(clipLibraries.created_at);

  // One round-trip aggregating stock_clips counts per library + most
  // recent ready timestamp. Keeps the list page render under one
  // request per library + one for the aggregation.
  const counts = await db
    .select({
      library_id: stockClips.clip_library_id,
      status: stockClips.status,
      n: sql<number>`count(*)::int`,
      max_ts: sql<Date | null>`max(${stockClips.created_at}) filter (where ${stockClips.status} = 'ready')`,
    })
    .from(stockClips)
    .groupBy(stockClips.clip_library_id, stockClips.status);

  const byLib = new Map<string, ClipLibraryWithCounts>();
  for (const l of libs) {
    byLib.set(l.id, {
      ...l,
      ready_count: 0,
      queued_count: 0,
      generating_count: 0,
      failed_count: 0,
      total_count: 0,
      last_ready_at: null,
    });
  }
  for (const c of counts) {
    if (!c.library_id) continue;
    const entry = byLib.get(c.library_id);
    if (!entry) continue;
    const status = c.status as "queued" | "generating" | "ready" | "failed";
    if (status === "queued") entry.queued_count = c.n;
    if (status === "generating") entry.generating_count = c.n;
    if (status === "ready") {
      entry.ready_count = c.n;
      entry.last_ready_at = c.max_ts ?? entry.last_ready_at;
    }
    if (status === "failed") entry.failed_count = c.n;
    entry.total_count += c.n;
  }
  return [...byLib.values()];
}

export async function getClipLibraryById(
  id: string,
  tx?: Transaction,
): Promise<ClipLibrary | null> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .select()
    .from(clipLibraries)
    .where(eq(clipLibraries.id, id))
    .limit(1);
  return row ?? null;
}

export async function createClipLibrary(
  spec: NewClipLibrary,
  tx?: Transaction,
): Promise<ClipLibrary> {
  const db = getDbOrTx(tx);
  const [row] = await db.insert(clipLibraries).values(spec).returning();
  if (!row) throw new Error("createClipLibrary returned no row");
  return row;
}

export async function updateClipLibrary(
  id: string,
  patch: Partial<NewClipLibrary>,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db.update(clipLibraries).set(patch).where(eq(clipLibraries.id, id));
}
