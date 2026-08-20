import type { NextRequest } from "next/server";
import { Queue } from "bullmq";
import { desc, eq, sql } from "drizzle-orm";
import { createRedisConnection, QUEUE_NAMES } from "@repo/queue";
import {
  cfPersonas,
  cfSources,
  cfRawClips,
  cfAccounts,
  cfDistributions,
  cfJobFailures,
  cfCaptionPresets,
  cfCaptionPool,
} from "@repo/db";
import { withApiAuth } from "../../_lib/auth";
import { db } from "@/lib/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// All four Clip Forge queues. CF_FINISHING_RENDER was missing, so the queue
// depths the console reported silently excluded the stage that produces the
// actual publishable MP4 — the one most likely to be backed up.
const CF_QUEUE_LIST = [
  QUEUE_NAMES.CF_INGEST,
  QUEUE_NAMES.CF_CLIP_DETECTION,
  QUEUE_NAMES.CF_RAW_RENDER,
  QUEUE_NAMES.CF_FINISHING_RENDER,
];

/**
 * GET /api/v1/clip-forge/console
 *
 * Single aggregator the console UI subscribes to. Returns everything every
 * screen needs in one shot so the UI can poll one URL and stop juggling
 * synthetic fallbacks. All arrays come back empty when the DB is empty —
 * that IS the real state until the user ingests something.
 */
export async function GET(req: NextRequest) {
  return withApiAuth(req, async () => {
    const [
      personas,
      sources,
      rawClips,
      accounts,
      distributions,
      jobFailures,
      presets,
      captionPool,
      queueDepths,
    ] = await Promise.all([
      db.select().from(cfPersonas).orderBy(desc(cfPersonas.created_at)),
      db
        .select()
        .from(cfSources)
        .orderBy(desc(cfSources.created_at))
        .limit(200),
      db
        .select()
        .from(cfRawClips)
        .orderBy(desc(cfRawClips.created_at))
        .limit(500),
      db.select().from(cfAccounts).orderBy(desc(cfAccounts.created_at)),
      db
        .select()
        .from(cfDistributions)
        .orderBy(desc(cfDistributions.created_at))
        .limit(500),
      db
        .select()
        .from(cfJobFailures)
        .orderBy(desc(cfJobFailures.created_at))
        .limit(100),
      db
        .select()
        .from(cfCaptionPresets)
        .orderBy(desc(cfCaptionPresets.created_at)),
      db
        .select()
        .from(cfCaptionPool)
        .orderBy(desc(cfCaptionPool.created_at))
        .limit(200),
      fetchQueueDepths(),
    ]);

    // Cheap derived stats. Counts come from already-loaded arrays so we
    // don't bounce the DB twice.
    const stats = {
      sources: sources.length,
      clips: rawClips.length,
      clips_ready: rawClips.filter((c) => c.status === "ready").length,
      clips_rendering: rawClips.filter((c) => c.status === "rendering").length,
      clips_detected: rawClips.filter((c) => c.status === "detected").length,
      distributions: distributions.length,
      dists_live: distributions.filter((d) => d.status === "live").length,
      dists_qc_flag: distributions.filter((d) => d.status === "qc_flag").length,
      accounts: accounts.length,
      accounts_active: accounts.filter((a) => a.active).length,
      errors: jobFailures.length,
      dlq: jobFailures.length, // every row in cf_job_failures is by definition in DLQ
      personas: personas.length,
    };

    // Recent state-changing activity, merged across the three tables.
    const recent = [
      ...sources.slice(0, 20).map((s) => ({
        kind: "source" as const,
        id: s.id,
        status: s.status,
        ts: s.created_at,
        label: s.title,
      })),
      ...rawClips.slice(0, 30).map((c) => ({
        kind: "clip" as const,
        id: c.id,
        status: c.status,
        ts: c.created_at,
        label: c.score_reason || c.id,
      })),
      ...distributions.slice(0, 20).map((d) => ({
        kind: "dist" as const,
        id: d.id,
        status: d.status,
        ts: d.created_at,
        label: d.post_url ?? d.id,
      })),
    ]
      .sort((a, b) => (b.ts?.getTime?.() ?? 0) - (a.ts?.getTime?.() ?? 0))
      .slice(0, 30);

    return {
      personas,
      sources,
      raw_clips: rawClips,
      accounts,
      distributions,
      job_failures: jobFailures,
      caption_presets: presets,
      caption_pool: captionPool,
      queue_depths: queueDepths,
      stats,
      recent_activity: recent,
    };
  });
}

interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

async function fetchQueueDepths(): Promise<QueueDepth[]> {
  const cfg = getHubConfig();
  const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
  try {
    const out = await Promise.all(
      CF_QUEUE_LIST.map(async (name): Promise<QueueDepth> => {
        const q = new Queue(name, { connection: conn });
        try {
          const c = await q.getJobCounts(
            "waiting",
            "active",
            "delayed",
            "failed",
          );
          return {
            name,
            waiting: c.waiting ?? 0,
            active: c.active ?? 0,
            delayed: c.delayed ?? 0,
            failed: c.failed ?? 0,
          };
        } finally {
          await q.close();
        }
      }),
    );
    return out;
  } finally {
    await conn.quit().catch(() => {});
  }
}
