// Load environment variables before anything else
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load from project root (../../../.env from src/index.ts -> apps/worker-orchestrator/src -> apps/worker-orchestrator -> apps -> root)
config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "@repo/config";
import { createDrizzleClient } from "@repo/db";
import { initializeDb } from "@repo/db/singleton";
import { bootstrapValidation } from "@repo/domain";
import { startProviderProber } from "./services/provider-prober.js";
import {
  createRedisConnection,
  closeRedisConnection,
  attachStandardEventListeners,
  createDeadLetterWorker,
  createThumbnailWorker,
  createThumbnailQueue,
  createTutorialGenerateQueue,
  createTutorialSpliceQueue,
  createTutorialStitchQueue,
  createTutorialTranslateQueue,
  createTutorialGenerateWorker,
  createTutorialSpliceWorker,
  createTutorialStitchWorker,
  createTutorialTranslateWorker,
} from "@repo/queue";
import { createThumbnailProcessor } from "./processors/thumbnail.js";
import { startStaleJobWatchdog } from "./watchdog/stale-job-watchdog.js";
import { startTutorialCleanupInterval } from "./watchdog/tutorial-cleanup.js";
import { startJobAutoDeleteInterval } from "./watchdog/job-auto-delete.js";
import { startTutorialRetentionInterval } from "./watchdog/tutorial-retention.js";
import { startStitchReconcilerInterval } from "./watchdog/stitch-reconciler.js";
import { reconcileSplicingJobs } from "./watchdog/splice-reconciler.js";
import { createTutorialGenerateProcessor } from "./processors/tutorial/generate.js";
import { createTutorialSpliceProcessor } from "./processors/tutorial/splice.js";
import { createTutorialStitchProcessor } from "./processors/tutorial/stitch.js";
import { createTutorialTranslateProcessor } from "./processors/tutorial/translate.js";
import { updateJobStatus } from "./utils/update-job-status.js";
import { buildErrorDetail } from "@repo/contracts";
import { ai33CircuitBreaker } from "./utils/ai33-circuit-breaker.js";
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";

/**
 * Worker Orchestrator Application (Tutorial Studio — single-tenant)
 *
 * Lightweight orchestration worker for BullMQ consumers. This build is pruned
 * to the tutorial production pipeline plus the shared thumbnail processor:
 * tutorial-generate → tutorial-splice → tutorial-stitch, with thumbnails.
 *
 * Architecture:
 * - Event-driven chaining: workers update DB, write events, dispatch next jobs
 * - No polling: pure event propagation via BullMQ and PostgreSQL LISTEN/NOTIFY
 * - Graceful shutdown: drain workers before exit
 *
 * Boot sequence:
 * 1. Load and validate config
 * 2. Create Redis connections (one per worker)
 * 3. Create Drizzle DB client
 * 4. Create queues (for dispatch-next)
 * 5. Create processors (with queue dependencies)
 * 6. Initialize all workers
 * 7. Attach event listeners for observability
 * 8. Setup graceful shutdown handlers
 */

// Track workers for graceful shutdown
const workers: Worker[] = [];

async function bootstrap() {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting worker-orchestrator",
      timestamp: new Date().toISOString(),
    }),
  );

  // 1. Load and validate environment config
  const config = loadConfig();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Config loaded",
      node_env: config.NODE_ENV,
    }),
  );

  // 1.5. Bootstrap validation system
  bootstrapValidation();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Validation harness initialized",
    }),
  );

  // 2. Initialize database singleton
  initializeDb(config.DATABASE_URL);
  const db = createDrizzleClient(config.DATABASE_URL);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Database initialized",
    }),
  );

  // 2.5. Scheduled provider health probing (System Health, Phase A3). This is
  // the long-lived process that holds every credential, so it is the honest
  // place to measure provider health on a schedule (not the request-scoped
  // hub-web). Never throws into bootstrap — the loop swallows its own errors.
  try {
    startProviderProber({ db, env: process.env });
  } catch (proberErr) {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "Provider prober failed to start (non-fatal)",
        error:
          proberErr instanceof Error ? proberErr.message : String(proberErr),
      }),
    );
  }

  // 3. Create Redis connections (one per worker - BullMQ requirement)
  const deadLetterConnection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const thumbnailWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const thumbnailQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialGenerateWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialGenerateQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialSpliceWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialSpliceQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialStitchWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialStitchQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });
  const tutorialTranslateWorkerConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "worker",
  });
  const tutorialTranslateQueueConn = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });

  const allConnections = [
    deadLetterConnection,
    thumbnailWorkerConn,
    thumbnailQueueConn,
    tutorialGenerateWorkerConn,
    tutorialGenerateQueueConn,
    tutorialSpliceWorkerConn,
    tutorialSpliceQueueConn,
    tutorialStitchWorkerConn,
    tutorialStitchQueueConn,
    tutorialTranslateWorkerConn,
    tutorialTranslateQueueConn,
  ];

  console.log(
    JSON.stringify({
      level: "info",
      message: "Redis connections created",
      connection_count: allConnections.length,
    }),
  );

  // 3.5. Wait for all Redis connections to be ready
  // CRITICAL: BullMQ workers silently fail to process jobs if connections aren't ready
  await Promise.all(
    allConnections.map((conn) => {
      if (conn.status === "ready") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        conn.once("ready", () => resolve());
      });
    }),
  );

  console.log(
    JSON.stringify({
      level: "info",
      message: "All Redis connections ready",
      connection_count: allConnections.length,
    }),
  );

  // 3.6. Proactive AI33 health check — open circuit immediately if imagen is down,
  // then poll every 2 min so outages are caught before any job fails.
  // Must be awaited so no jobs run before the circuit state is known.
  try {
    // Use backup key for health checks if available — backup key gives accurate maintenance/status
    // while primary key may be rate-limited (429) and can't report proper imagen status.
    const healthCheckKey = process.env["AI33_API_KEY_2"] ?? config.AI33_API_KEY;
    await ai33CircuitBreaker.init(healthCheckKey);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "AI33 startup health check failed (non-fatal)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 3.7. Flush Redis Lua script cache — prevents stall-recovery failures when a
  // prior crash left corrupt script entries. BullMQ reloads scripts lazily.
  try {
    await (tutorialGenerateWorkerConn as unknown as {
      script: (cmd: string) => Promise<unknown>;
    }).script("FLUSH");
    console.log(
      JSON.stringify({
        level: "info",
        message: "Redis Lua script cache flushed (stall-recovery hardening)",
      }),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "SCRIPT FLUSH failed (non-fatal)",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 4. Create queues (needed for dispatch-next)
  const tutorialGenerateQueue = createTutorialGenerateQueue(
    tutorialGenerateQueueConn,
  );
  const tutorialSpliceQueue = createTutorialSpliceQueue(
    tutorialSpliceQueueConn,
  );
  const tutorialStitchQueue = createTutorialStitchQueue(
    tutorialStitchQueueConn,
  );
  const tutorialTranslateQueue = createTutorialTranslateQueue(
    tutorialTranslateQueueConn,
  );
  const thumbnailQueue = createThumbnailQueue(thumbnailQueueConn);

  // 5. Create processors (pass queues for dispatch-next)
  const thumbnailProcessor = createThumbnailProcessor(db);
  const tutorialGenerateProcessor = createTutorialGenerateProcessor(db, {
    tutorialGenerate: tutorialGenerateQueue,
  });
  const tutorialSpliceProcessor = createTutorialSpliceProcessor(db, {
    tutorialStitch: tutorialStitchQueue,
    thumbnail: thumbnailQueue,
  });
  const tutorialStitchProcessor = createTutorialStitchProcessor(db, {
    thumbnail: thumbnailQueue,
  });
  // Translate lane reuses the EXISTING splice lane: after translate + TTS it
  // enqueues tutorial-splice for the child, so splice + the Drive scanner
  // finish it (reuse, don't reinvent).
  const tutorialTranslateProcessor = createTutorialTranslateProcessor(db, {
    tutorialSplice: tutorialSpliceQueue,
  });

  // 6. Initialize workers
  const thumbnailWorker = createThumbnailWorker(
    thumbnailWorkerConn,
    thumbnailProcessor,
  );
  const tutorialGenerateWorker = createTutorialGenerateWorker(
    tutorialGenerateWorkerConn,
    tutorialGenerateProcessor,
  );
  const tutorialSpliceWorker = createTutorialSpliceWorker(
    tutorialSpliceWorkerConn,
    tutorialSpliceProcessor,
  );
  const tutorialStitchWorker = createTutorialStitchWorker(
    tutorialStitchWorkerConn,
    tutorialStitchProcessor,
  );
  const tutorialTranslateWorker = createTutorialTranslateWorker(
    tutorialTranslateWorkerConn,
    tutorialTranslateProcessor,
  );
  const deadLetterWorker = createDeadLetterWorker(
    deadLetterConnection,
    async (job) => {
      // Extract job data for type safety
      const data = job.data as { job_id?: string } | undefined;

      // Build comprehensive error context for operator debugging
      const errorDetails = {
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? "unknown reason",
        stackTrace: job.stacktrace?.slice(0, 3) ?? [], // Last 3 errors
        timestamp: new Date().toISOString(),
        jobData: job.data, // Full payload for debugging
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      };

      // Spec-compliant structured log format with grep-able prefix
      console.error(
        JSON.stringify({
          level: "error",
          event: "dead_letter_queue_exhausted",
          prefix: "[dead-letter]", // Keeps grep-ability
          job_id: data?.job_id,
          bullmq_job_id: job.id,
          bullmq_job_name: job.name,
          attempts_made: job.attemptsMade,
          failed_reason: job.failedReason ?? "unknown reason",
          stack_trace: job.stacktrace?.slice(0, 3) ?? [],
          job_data: job.data,
          processed_on: job.processedOn,
          finished_on: job.finishedOn,
          timestamp: new Date().toISOString(),
        }),
      );

      // Write failure to DB so operators can see it in the Hub
      if (data?.job_id) {
        try {
          await updateJobStatus(
            db,
            data.job_id,
            "FAILED_IRRECOVERABLE",
            errorDetails.failedReason,
            buildErrorDetail({
              code: "DEAD_LETTER",
              message: errorDetails.failedReason,
              category: "orchestration",
              retryable: false,
              context: {
                attempts_made: job.attemptsMade,
                queue_name: job.queueName,
                bq_job_id: job.id,
                failed_reason: job.failedReason ?? null,
              },
            }),
            errorDetails, // Pass full error details to error_metadata
          );
        } catch (updateErr) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "dead_letter_db_update_failed",
              job_id: data.job_id,
              error:
                updateErr instanceof Error
                  ? updateErr.message
                  : String(updateErr),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    },
  );

  // Track workers for graceful shutdown
  workers.push(
    thumbnailWorker,
    tutorialGenerateWorker,
    tutorialSpliceWorker,
    tutorialStitchWorker,
    tutorialTranslateWorker,
    deadLetterWorker,
  );

  // 7. Attach event listeners for observability
  attachStandardEventListeners(thumbnailWorker, "thumbnail-worker");
  attachStandardEventListeners(
    tutorialGenerateWorker,
    "tutorial-generate-worker",
  );
  attachStandardEventListeners(tutorialSpliceWorker, "tutorial-splice-worker");
  attachStandardEventListeners(tutorialStitchWorker, "tutorial-stitch-worker");
  attachStandardEventListeners(
    tutorialTranslateWorker,
    "tutorial-translate-worker",
  );
  attachStandardEventListeners(deadLetterWorker, "dead-letter-worker");

  console.log(
    JSON.stringify({
      level: "info",
      message: "Workers initialized",
      workers: [
        "thumbnail-worker",
        "tutorial-generate-worker",
        "tutorial-splice-worker",
        "tutorial-stitch-worker",
        "tutorial-translate-worker",
        "dead-letter-worker",
      ],
    }),
  );

  // 8. Start stale job watchdog (runs every 5 minutes)
  startStaleJobWatchdog(db);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Stale job watchdog started",
    }),
  );

  // 8c. Tutorial cleanup — reclaims >48h-old TTS chunk files left behind
  // by interrupted tutorial-generate runs. Runs once at startup + hourly.
  startTutorialCleanupInterval();
  console.log(
    JSON.stringify({
      level: "info",
      message: "Tutorial cleanup watchdog started",
    }),
  );

  // 8d. Job auto-delete — hard-deletes STALLED non-published jobs 48h after
  // their last state change. Every human-in-the-loop state is exempt; see the
  // exemption list in job-auto-delete.ts for why that matters.
  startJobAutoDeleteInterval(db, config.REDIS_URL);
  console.log(
    JSON.stringify({
      level: "info",
      message:
        "Job auto-delete watchdog started (TTL: 48h since last state change)",
    }),
  );

  // 8e. Tutorial VPS retention — Drive is the permanent store, the box keeps
  // ~7 days. DRY RUN unless TUTORIAL_RETENTION_ENABLED=true, and a file is
  // only ever removed when its Drive copy is confirmed by drive_file_id.
  startTutorialRetentionInterval(db, config.LOCAL_MEDIA_ROOT);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Tutorial retention watchdog started",
      enabled: process.env["TUTORIAL_RETENTION_ENABLED"] === "true",
      retention_days: process.env["TUTORIAL_RETENTION_DAYS"] ?? "7",
    }),
  );

  // 8f. Stitch reconciler — promotes LONG_FORM parents whose stitch job
  // finished but whose write-back never landed, and surfaces anything that must
  // not be auto-fixed. Runs at startup + every 10 minutes.
  //
  // This is the backstop for the failure that hid 28 finished videos for up to
  // 28 days: the write-back existed in src but was never compiled into the
  // deployed bundle, and nothing ever re-checked.
  startStitchReconcilerInterval(db);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Stitch reconciler started (every 10m)",
    }),
  );

  // 8g. Splice reconciler — recovers tutorial jobs left in SPLICING /
  // AWAITING_UPLOAD by a worker killed mid-splice. Runs at startup + every 10m.
  const runSpliceReconciler = () => {
    reconcileSplicingJobs(db, tutorialSpliceQueue).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "[splice-reconciler] cycle failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  };
  runSpliceReconciler();
  setInterval(runSpliceReconciler, 10 * 60 * 1000);
  console.log(
    JSON.stringify({
      level: "info",
      message: "Splice reconciler started (every 10m)",
    }),
  );

  // 9. Setup graceful shutdown
  setupGracefulShutdown(allConnections);

  console.log(
    JSON.stringify({
      level: "info",
      message: "Worker orchestrator running",
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Graceful Shutdown Handler
 *
 * Drains all workers and closes all connections before exit.
 * Triggered by SIGINT (Ctrl+C) or SIGTERM (Docker/Kubernetes).
 *
 * Error Handling Strategy:
 * - Individual worker/connection failures do not block shutdown
 * - Each failure is logged but shutdown continues for remaining workers
 * - Force exit after 30s timeout to prevent hanging on stuck processes
 */
function setupGracefulShutdown(connections: Redis[]) {
  const shutdown = async (signal: string) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: `Received ${signal}, starting graceful shutdown`,
        timestamp: new Date().toISOString(),
      }),
    );

    // Hard-exit after 30s if drain hangs
    const forceExitTimer = setTimeout(() => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Graceful shutdown timeout — force exiting",
          timestamp: new Date().toISOString(),
        }),
      );
      process.exit(1);
    }, 30_000);
    forceExitTimer.unref();

    // 1. Drain all workers (complete in-flight jobs, reject new ones)
    console.log(
      JSON.stringify({
        level: "info",
        message: "Draining workers",
        worker_count: workers.length,
      }),
    );

    // Close each worker individually so one failure doesn't block others
    const closeResults = await Promise.allSettled(
      workers.map(async (worker) => {
        try {
          await worker.close();
          return { success: true };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "Worker close() failed, continuing shutdown",
              worker_name: worker.name,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            }),
          );
          return { success: false, error };
        }
      }),
    );

    // Log summary of worker closures
    const successCount = closeResults.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const failedCount = workers.length - successCount;
    console.log(
      JSON.stringify({
        level: "info",
        message: "Workers drain complete",
        closed_successfully: successCount,
        failed_to_close: failedCount,
      }),
    );

    // 2. Close all Redis connections
    console.log(
      JSON.stringify({
        level: "info",
        message: "Closing Redis connections",
        connection_count: connections.length,
      }),
    );

    // Close each connection individually so one failure doesn't block others
    const connectionResults = await Promise.allSettled(
      connections.map(async (conn) => {
        try {
          await closeRedisConnection(conn);
          return { success: true };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "Redis connection close failed, continuing shutdown",
              error: errorMsg,
              timestamp: new Date().toISOString(),
            }),
          );
          return { success: false, error };
        }
      }),
    );

    // Log summary of connection closures
    const connSuccessCount = connectionResults.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const connFailedCount = connections.length - connSuccessCount;
    console.log(
      JSON.stringify({
        level: "info",
        message: "Redis connections closed",
        closed_successfully: connSuccessCount,
        failed_to_close: connFailedCount,
      }),
    );

    clearTimeout(forceExitTimer);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Graceful shutdown complete",
        timestamp: new Date().toISOString(),
      }),
    );

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Boot the application
bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      message: "Failed to start worker-orchestrator",
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
