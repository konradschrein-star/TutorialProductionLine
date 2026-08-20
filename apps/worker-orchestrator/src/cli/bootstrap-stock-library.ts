#!/usr/bin/env node
/**
 * Stock Library Bootstrap CLI
 *
 * Generates N stock clips for the drama stock-chain template.
 *
 * Flow:
 *   1. Call Gemini in batches to produce VEO scene prompts.
 *   2. For each prompt, insert a stock_clips row in 'queued' state.
 *   3. Enqueue a stock-library-gen BullMQ job referencing that row.
 *   4. Exit. The orchestrator's stock-library-gen worker drains the
 *      queue in the background — you can close this terminal.
 *
 * Usage:
 *   pnpm --filter @repo/worker-orchestrator stock-library:bootstrap -- \
 *     --count 5000 [--batch-size 100] [--resume]
 *
 *   --count       Total clips to produce.
 *   --batch-size  Prompts requested per Gemini call (default 100).
 *   --resume      Skip the prompt-gen+insert phase and just re-enqueue
 *                 every stock_clips row that's still status='queued'
 *                 — useful after a worker restart or after manually
 *                 marking failed rows back to queued.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../../.env") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@repo/db";
import { stockClips, clipLibraries } from "@repo/db";
import { loadConfig } from "@repo/config";
import { initializeDb } from "@repo/db/singleton";
import {
  countReadyStockClips,
  reserveStockClip,
  takeQueuedStockClips,
} from "@repo/db/repositories";
import {
  createRedisConnection,
  closeRedisConnection,
  createStockLibraryGenQueue,
} from "@repo/queue";
import { generatePromptBatch as generateGemini } from "../processors/stock-library/prompt-corpus-gemini.js";
import { generatePromptBatch as generateOllama } from "../processors/stock-library/prompt-corpus-ollama.js";
import { generatePromptBatch as generateGeminiDiverse } from "../processors/stock-library/prompt-corpus-diverse.js";

interface CliOpts {
  count: number;
  batchSize: number;
  resume: boolean;
  libraryId: string | null;
  llm: "gemini" | "ollama" | "gemini-diverse";
}

function parseArgs(): CliOpts {
  const argv = process.argv.slice(2);
  let count = 0;
  let batchSize = 100;
  let resume = false;
  let libraryId: string | null = null;
  let llm: "gemini" | "ollama" | "gemini-diverse" = "gemini";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--count") count = Number(argv[++i]);
    else if (a === "--batch-size") batchSize = Number(argv[++i]);
    else if (a === "--resume") resume = true;
    else if (a === "--library") libraryId = argv[++i] ?? null;
    else if (a === "--llm") {
      const v = argv[++i];
      if (v !== "gemini" && v !== "ollama" && v !== "gemini-diverse") {
        console.error(`--llm must be gemini, gemini-diverse, or ollama`);
        process.exit(1);
      }
      llm = v;
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!resume && (!Number.isFinite(count) || count <= 0)) {
    console.error("Either --count <N> or --resume is required.");
    process.exit(1);
  }
  if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 200) {
    console.error("--batch-size must be between 1 and 200.");
    process.exit(1);
  }
  return { count, batchSize, resume, libraryId, llm };
}

async function main() {
  const opts = parseArgs();
  const databaseUrl =
    process.env["DATABASE_URL_OVERRIDE"] ?? process.env["DATABASE_URL"];
  const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or DATABASE_URL_OVERRIDE env var required");
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: "Connecting",
      database_user: new URL(databaseUrl).username,
      redis: redisUrl,
    }),
  );
  // Skip loadConfig — it has stricter validation that the worker
  // process needs but is overkill for a one-shot CLI launcher and
  // also tries to validate keys we don't need here.
  void loadConfig;
  // The repos pull their handle from @repo/db's singleton — pass the
  // raw URL string in (NOT a Drizzle client; the function expects
  // a connection string).
  initializeDb(databaseUrl);
  void schema;
  // Build a local Drizzle handle for the post-insert library tagging
  // (the existing reserveStockClip helper doesn't take a library_id).
  const localSql = postgres(databaseUrl);
  const localDb = drizzle(localSql);

  // Resolve target library — explicit --library wins; otherwise pick
  // the Black Drama default by slug, so a bare `--count 5000` does
  // the right thing for the user.
  let libraryId: string | null = opts.libraryId;
  if (!libraryId) {
    const [defaultLib] = await localDb
      .select({ id: clipLibraries.id })
      .from(clipLibraries)
      .where(eq(clipLibraries.slug, "black-drama-default"))
      .limit(1);
    libraryId = defaultLib?.id ?? null;
  }
  if (!libraryId) {
    throw new Error(
      "No library resolved. Pass --library <uuid> or seed the default.",
    );
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: "Library scope",
      library_id: libraryId,
    }),
  );

  const queueConn = createRedisConnection({
    url: redisUrl,
    mode: "queue",
  });
  const queue = createStockLibraryGenQueue(queueConn);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Stock library bootstrap starting",
      count: opts.count,
      batch_size: opts.batchSize,
      resume: opts.resume,
    }),
  );

  if (opts.resume) {
    // Re-enqueue every still-queued row in bulk.
    // After enqueueing each batch we stamp veo_job_id = 'bootstrap-dispatched'
    // so takeQueuedStockClips (which filters on veo_job_id IS NULL) skips
    // them on the next iteration. The gen worker overwrites veo_job_id with
    // the real value when it picks the job up.
    let total = 0;
    while (true) {
      const batch = await takeQueuedStockClips(500);
      if (batch.length === 0) break;
      await queue.addBulk(
        batch.map((row) => ({
          name: "stock-library-gen",
          data: { stockClipId: row.id },
          // Suffix jobId with run-time so re-attempts after a prior failed
          // run aren't dropped by BullMQ's idempotency.
          opts: {
            jobId: `stock-${row.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            // 72 attempts × 1hr fixed backoff = retry every hour for 3 days.
            // Survives hourly rate-limit resets without manual intervention.
            attempts: 72,
            backoff: { type: "fixed", delay: 3_600_000 },
          },
        })),
      );
      // Mark as dispatched so the next takeQueuedStockClips call skips them.
      await localDb
        .update(stockClips)
        .set({ veo_job_id: "bootstrap-dispatched" })
        .where(
          inArray(
            stockClips.id,
            batch.map((r) => r.id),
          ),
        );
      total += batch.length;
      console.log(
        JSON.stringify({
          level: "info",
          message: "Resume batch enqueued",
          enqueued: batch.length,
          running_total: total,
        }),
      );
    }
    console.log(
      JSON.stringify({
        level: "info",
        message: "Resume complete",
        total_enqueued: total,
      }),
    );
  } else {
    const existing = await countReadyStockClips();
    console.log(
      JSON.stringify({
        level: "info",
        message: "Existing ready clips",
        ready_count: existing,
        target_total: existing + opts.count,
        llm: opts.llm,
      }),
    );

    const generatePromptBatch =
      opts.llm === "ollama"
        ? generateOllama
        : opts.llm === "gemini-diverse"
          ? generateGeminiDiverse
          : generateGemini;

    let produced = 0;
    while (produced < opts.count) {
      const remaining = opts.count - produced;
      const wantThisBatch = Math.min(opts.batchSize, remaining);
      let batch: Awaited<ReturnType<typeof generatePromptBatch>> = [];
      try {
        batch = await generatePromptBatch(wantThisBatch);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Batch failed, retrying once",
            llm: opts.llm,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        try {
          batch = await generatePromptBatch(wantThisBatch);
        } catch (err2) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "Batch failed twice; aborting",
              llm: opts.llm,
              produced_so_far: produced,
              error: err2 instanceof Error ? err2.message : String(err2),
            }),
          );
          process.exit(2);
        }
      }
      if (batch.length === 0) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Gemini batch returned 0 usable prompts; retrying",
          }),
        );
        continue;
      }

      // Reserve all rows in this batch then enqueue them all in bulk.
      const rows: { id: string }[] = [];
      for (const pick of batch) {
        const row = await reserveStockClip({
          prompt: pick.prompt,
          vibe_tag: pick.vibe_tag,
          origin: "bootstrap",
        });
        // Tag the row with the library it belongs to. The helper
        // doesn't take a library_id directly, so we patch it here.
        await localDb
          .update(stockClips)
          .set({ clip_library_id: libraryId })
          .where(eq(stockClips.id, row.id));
        rows.push(row);
      }
      await queue.addBulk(
        rows.map((row) => ({
          name: "stock-library-gen",
          data: { stockClipId: row.id },
          // Suffix jobId with run-time so re-attempts after a prior failed
          // run aren't dropped by BullMQ's idempotency.
          opts: {
            jobId: `stock-${row.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            // 72 attempts × 1hr fixed backoff = retry every hour for 3 days.
            // Survives hourly rate-limit resets without manual intervention.
            attempts: 72,
            backoff: { type: "fixed", delay: 3_600_000 },
          },
        })),
      );
      produced += batch.length;
      console.log(
        JSON.stringify({
          level: "info",
          message: "Batch reserved + enqueued",
          batch_size: batch.length,
          produced_running_total: produced,
          target: opts.count,
        }),
      );
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "Bootstrap enqueue complete",
        produced,
      }),
    );
  }

  await queue.close();
  await closeRedisConnection(queueConn);
  console.log(
    "Done. The worker-orchestrator will now generate clips in the background.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[fatal]", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
