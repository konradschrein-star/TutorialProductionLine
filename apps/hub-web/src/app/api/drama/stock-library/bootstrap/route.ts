import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { verifyToken } from "@/lib/auth/jwt";
import { db, stockClips } from "@/lib/db";
import { eq } from "drizzle-orm";
import { reserveStockClip } from "@repo/db/repositories";
import { generatePromptBatch } from "@/lib/stock-library/prompt-corpus-gemini";
import { getClipLibraryById } from "@repo/db/repositories";

export const dynamic = "force-dynamic";

const QUEUE_NAME = "queue-stock-library-gen";

/**
 * POST /api/drama/stock-library/bootstrap
 *
 * Body: { count: number, batchSize?: number }
 *
 * Drives the same flow as the CLI bootstrap-stock-library tool, but
 * from inside the hub so the operator can click a button after a
 * sanity-check.
 *
 * Returns immediately after the FIRST batch is enqueued — the remaining
 * batches keep enqueueing in the background as Gemini returns them.
 * For 5000 clips at batchSize=100, that's ~50 Gemini calls @ ~5s each
 * = ~4 min total. We don't block the HTTP response for that long; the
 * UI polls /api/drama/stock-library and watches the queued count climb.
 */
export async function POST(req: NextRequest) {
  const token = (await cookies()).get("hub_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    count?: number;
    batchSize?: number;
    libraryId?: string;
  };
  const count = Number(body.count);
  const batchSize = Math.min(Math.max(Number(body.batchSize ?? 100), 1), 200);
  const libraryId = body.libraryId ?? null;
  if (!Number.isFinite(count) || count <= 0 || count > 50000) {
    return NextResponse.json(
      { error: "count must be 1..50000" },
      { status: 400 },
    );
  }
  if (!libraryId || !/^[0-9a-f-]{36}$/.test(libraryId)) {
    return NextResponse.json(
      { error: "libraryId is required" },
      { status: 400 },
    );
  }

  const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: conn });

  // Fire the loop in the background so we can return immediately.
  // Errors propagate to the logs via console.error so the UI's log
  // tail surfaces them.
  void (async () => {
    let produced = 0;
    let batchNo = 0;
    while (produced < count) {
      const remaining = count - produced;
      const want = Math.min(batchSize, remaining);
      try {
        // Resolve the library each iteration so a manual edit of
        // character_block while the bootstrap is mid-flight takes
        // effect on subsequent batches.
        const lib = await getClipLibraryById(libraryId);
        const batch = await generatePromptBatch(want, lib?.character_block);
        if (batch.length === 0) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "stock_bootstrap_empty_batch",
              batch_no: batchNo,
            }),
          );
          continue;
        }
        const reserved: { id: string }[] = [];
        for (const pick of batch) {
          const row = await reserveStockClip({
            prompt: pick.prompt,
            vibe_tag: pick.vibe_tag,
            origin: "bootstrap",
          });
          // Scope row to this library — reserveStockClip doesn't accept
          // library yet (would have changed the repo signature widely);
          // patch it in here.
          await db
            .update(stockClips)
            .set({ clip_library_id: libraryId })
            .where(eq(stockClips.id, row.id));
          reserved.push(row);
        }
        await queue.addBulk(
          reserved.map((r) => ({
            name: "stock-library-gen",
            data: { stockClipId: r.id },
            opts: {
              jobId: `stock-${r.id}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 7)}`,
              attempts: 3,
              backoff: { type: "exponential" as const, delay: 30_000 },
            },
          })),
        );
        produced += batch.length;
        batchNo++;
        console.warn(
          JSON.stringify({
            level: "info",
            event: "stock_bootstrap_batch",
            batch_no: batchNo,
            batch_size: batch.length,
            produced,
            target: count,
          }),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "stock_bootstrap_failure",
            batch_no: batchNo,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        // Brief pause before the next attempt so we don't hot-loop
        // against a failing Gemini endpoint.
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    await queue.close();
    await conn.quit();
    console.warn(
      JSON.stringify({
        level: "info",
        event: "stock_bootstrap_complete",
        produced,
      }),
    );
  })();

  return NextResponse.json({
    ok: true,
    requested_count: count,
    batch_size: batchSize,
    message: "Bootstrap started. Watch the table for queued count to climb.",
  });
}

void db;
void stockClips;
