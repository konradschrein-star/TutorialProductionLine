import { eq, sql } from "drizzle-orm";
import { storageDailyUsage, type DrizzleClient } from "@repo/db";

/**
 * Daily upload-byte budget.
 *
 * Google's binding limit is 750 GB uploaded per account per day. This tracks
 * bytes actually pushed per UTC date so the scanner can stop BEFORE the cliff —
 * visibly, with a reason (`daily_budget_exhausted`), never a silent stall.
 *
 * One Drive account = one shared budget across Content Forge, Tutorials, and
 * Clip Forge, so accounting is keyed on the date alone.
 */

/** `YYYY-MM-DD` in UTC — the accounting bucket. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getUsageBytes(
  db: DrizzleClient,
  dateKey: string = utcDateKey(),
): Promise<number> {
  const [row] = await db
    .select({ bytes: storageDailyUsage.bytes_uploaded })
    .from(storageDailyUsage)
    .where(eq(storageDailyUsage.usage_date, dateKey))
    .limit(1);
  return row?.bytes ?? 0;
}

export interface BudgetDecision {
  allowed: boolean;
  usedBytes: number;
  budgetBytes: number;
  remainingBytes: number;
}

/**
 * Would uploading `fileBytes` more today stay within `budgetBytes`?
 *
 * A file already larger than the whole budget is allowed through on an empty
 * day (otherwise a 600 GB raw recording could never upload) — the budget is a
 * throttle across many files, not a per-file cap (that is maxFileBytes's job).
 */
export async function checkBudget(
  db: DrizzleClient,
  fileBytes: number,
  budgetBytes: number,
  dateKey: string = utcDateKey(),
): Promise<BudgetDecision> {
  const used = await getUsageBytes(db, dateKey);
  const remaining = Math.max(0, budgetBytes - used);
  // Allow when nothing has been used yet (so a huge single file is not stuck
  // forever), or when it fits in the remaining budget.
  const allowed = used === 0 || fileBytes <= remaining;
  return {
    allowed,
    usedBytes: used,
    budgetBytes,
    remainingBytes: remaining,
  };
}

/** Atomically add `bytes` to today's usage. Upsert on the date key. */
export async function recordUsage(
  db: DrizzleClient,
  bytes: number,
  dateKey: string = utcDateKey(),
): Promise<void> {
  if (bytes <= 0) return;
  await db
    .insert(storageDailyUsage)
    .values({ usage_date: dateKey, bytes_uploaded: bytes, requests: 1 })
    .onConflictDoUpdate({
      target: storageDailyUsage.usage_date,
      set: {
        bytes_uploaded: sql`${storageDailyUsage.bytes_uploaded} + ${bytes}`,
        requests: sql`${storageDailyUsage.requests} + 1`,
        updated_at: new Date(),
      },
    });
}

/**
 * Priority ordering when the budget is tight: land the small, high-value
 * artefacts first so a 12 GB raw recording never starves a 4 KB transcript.
 * Lower number = uploaded first.
 */
export const UPLOAD_PRIORITY: Record<string, number> = {
  metadata: 0,
  transcript: 1,
  subtitles: 2,
  thumbnail: 3,
  final_video: 4,
  raw_recording: 5,
};

export function compareUploadPriority(a: string, b: string): number {
  return (UPLOAD_PRIORITY[a] ?? 99) - (UPLOAD_PRIORITY[b] ?? 99);
}
