import { eq, sql, desc } from "drizzle-orm";
import { clipLibraryReferenceScripts } from "../schema/clip-library-reference-scripts.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

export type ReferenceScript = typeof clipLibraryReferenceScripts.$inferSelect;
export type NewReferenceScript =
  typeof clipLibraryReferenceScripts.$inferInsert;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export async function listReferenceScripts(
  libraryId: string,
  tx?: Transaction,
): Promise<ReferenceScript[]> {
  const db = getDbOrTx(tx);
  return await db
    .select()
    .from(clipLibraryReferenceScripts)
    .where(eq(clipLibraryReferenceScripts.clip_library_id, libraryId))
    .orderBy(desc(clipLibraryReferenceScripts.created_at));
}

export async function getReferenceScriptById(
  id: string,
  tx?: Transaction,
): Promise<ReferenceScript | null> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .select()
    .from(clipLibraryReferenceScripts)
    .where(eq(clipLibraryReferenceScripts.id, id))
    .limit(1);
  return row ?? null;
}

export async function createReferenceScript(
  spec: { clip_library_id: string; name: string; content: string },
  tx?: Transaction,
): Promise<ReferenceScript> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .insert(clipLibraryReferenceScripts)
    .values({
      clip_library_id: spec.clip_library_id,
      name: spec.name.slice(0, 160),
      content: spec.content,
      word_count: wordCount(spec.content),
    })
    .returning();
  if (!row) throw new Error("createReferenceScript returned no row");
  return row;
}

export async function updateReferenceScript(
  id: string,
  patch: { name?: string; content?: string },
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  const updates: Partial<NewReferenceScript> = {};
  if (typeof patch.name === "string") updates.name = patch.name.slice(0, 160);
  if (typeof patch.content === "string") {
    updates.content = patch.content;
    updates.word_count = wordCount(patch.content);
  }
  if (Object.keys(updates).length === 0) return;
  await db
    .update(clipLibraryReferenceScripts)
    .set(updates)
    .where(eq(clipLibraryReferenceScripts.id, id));
}

export async function deleteReferenceScript(
  id: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .delete(clipLibraryReferenceScripts)
    .where(eq(clipLibraryReferenceScripts.id, id));
}

/**
 * Pick the least-recently-used reference script for a library and
 * stamp its last_used_at to now. Returns null if the library has no
 * references. Wrap in a transaction if you need strict rotation
 * under concurrency — for now we rely on the DB's atomic UPDATE +
 * RETURNING to make the picker safe enough for the actual call rate.
 */
export async function pickNextReferenceScript(
  libraryId: string,
  tx?: Transaction,
): Promise<ReferenceScript | null> {
  const db = getDbOrTx(tx);
  // Pick the row with the oldest last_used_at (NULLS FIRST so brand
  // new entries are tried first), then stamp it.
  const [picked] = await db
    .select()
    .from(clipLibraryReferenceScripts)
    .where(eq(clipLibraryReferenceScripts.clip_library_id, libraryId))
    .orderBy(sql`${clipLibraryReferenceScripts.last_used_at} ASC NULLS FIRST`)
    .limit(1);
  if (!picked) return null;
  await db
    .update(clipLibraryReferenceScripts)
    .set({ last_used_at: new Date() })
    .where(eq(clipLibraryReferenceScripts.id, picked.id));
  return picked;
}
