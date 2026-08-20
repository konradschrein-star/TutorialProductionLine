import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createCfClipDetectionQueue, createRedisConnection } from "@repo/queue";
import { withApiAuth } from "../../../../_lib/auth";
import { db } from "@/lib/db";
import { cfSources } from "@repo/db";
import { getHubConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/clip-forge/sources/:id/mine
 *   Enqueues a cf-clip-detection job for the source. Used by the Sources
 *   screen's "Mine clips" button. The source must be in `transcribed`
 *   state — earlier states won't have word timings yet.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiAuth(req, async () => {
    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, id))
      .limit(1);
    if (!source) {
      return new Response(JSON.stringify({ error: "source not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (source.status !== "transcribed" && source.status !== "extracted") {
      return new Response(
        JSON.stringify({
          error: `source is in '${source.status}' state — must be 'transcribed' (or already 'extracted' to re-mine)`,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    // Re-mining: flip status back to 'transcribed' so the detection
    // processor's pre-flight check passes.
    if (source.status === "extracted") {
      await db
        .update(cfSources)
        .set({ status: "transcribed" })
        .where(eq(cfSources.id, id));
    }

    const cfg = getHubConfig();
    const conn = createRedisConnection({ url: cfg.REDIS_URL, mode: "queue" });
    try {
      const queue = createCfClipDetectionQueue(conn);
      await queue.add("cf-clip-detection", { source_id: id });
      await queue.close();
    } finally {
      await conn.quit().catch(() => {});
    }
    return { queued: true };
  });
}
