import { sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";

/**
 * Merge a partial patch into a job's metadata JSONB column.
 * Uses PostgreSQL || operator to do a shallow merge.
 */
export async function updateJobMetadata(
  db: DrizzleClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.execute(
    sql`UPDATE content_jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || ${sql.raw("'" + JSON.stringify(patch).replace(/'/g, "''") + "'")}::jsonb WHERE id = ${jobId}`,
  );
}
