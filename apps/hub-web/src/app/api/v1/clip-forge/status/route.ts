import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/clip-forge/status
 *
 * Returns aggregate counts for the Clip Forge operations dashboard.
 * Hits cf_* tables once the migration is applied; before that, returns
 * zeros without erroring so the UI can still mount.
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    try {
      const [personas, sources, clipsReady, distsLive, dlq] = await Promise.all(
        [
          db.execute(sql`SELECT COUNT(*)::int AS c FROM cf_personas`),
          db.execute(sql`SELECT COUNT(*)::int AS c FROM cf_sources`),
          db.execute(
            sql`SELECT COUNT(*)::int AS c FROM cf_raw_clips WHERE status = 'ready'`,
          ),
          db.execute(
            sql`SELECT COUNT(*)::int AS c FROM cf_distributions WHERE status = 'live'`,
          ),
          db.execute(sql`SELECT COUNT(*)::int AS c FROM cf_job_failures`),
        ],
      );
      const cell = (r: unknown): number => {
        const arr = r as Array<{ c?: number }> | undefined;
        return arr?.[0]?.c ?? 0;
      };
      return {
        ok: true,
        counts: {
          personas: cell(personas),
          sources: cell(sources),
          clips_ready: cell(clipsReady),
          dists_live: cell(distsLive),
          dlq: cell(dlq),
        },
      };
    } catch (err) {
      // Pre-migration: tables don't exist yet. Surface this so the UI knows
      // to keep using its synthetic dataset until the migration is applied.
      return {
        ok: false,
        reason: "schema_not_migrated",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
