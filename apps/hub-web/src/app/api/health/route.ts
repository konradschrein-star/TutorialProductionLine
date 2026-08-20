import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { sql, and, lt } from "drizzle-orm";
import { Queue } from "bullmq";
import { db, contentJobs } from "@/lib/db";
import { getHubConfig } from "@/lib/config";
import { createRedisConnection, QUEUE_NAMES } from "@repo/queue";

/**
 * GET /api/health
 *
 * Public health check endpoint for UptimeRobot (no auth required).
 *
 * Runs all checks concurrently with a 5-second hard timeout.
 * Returns HTTP 200 for healthy, HTTP 503 for degraded/down.
 *
 * Status semantics:
 *   healthy   — all checks ok or skipped
 *   degraded  — at least one check degraded, none errored (returns 503)
 *   down      — at least one check errored, or timed out (returns 503)
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = "ok" | "error" | "degraded" | "skipped";
type TopLevelStatus = "healthy" | "degraded" | "down";

interface DatabaseCheck {
  status: "ok" | "error";
  latencyMs: number;
}

interface RedisCheck {
  status: "ok" | "error";
  latencyMs: number;
}

interface QueueCounts {
  waiting: number;
  active: number;
  failed: number;
  delayed?: number;
  completed?: number;
}

interface QueuesCheck {
  status: "ok" | "degraded";
  details: Record<string, QueueCounts>;
}

interface WorkersCheck {
  status: "ok" | "degraded";
  staleJobs: number;
}

interface DiskCheck {
  status: "ok" | "degraded" | "skipped";
  availableGb: number | null;
}

interface HealthResponse {
  status: TopLevelStatus;
  timestamp: string;
  checks: {
    database: DatabaseCheck;
    redis: RedisCheck;
    queues: QueuesCheck;
    workers: WorkersCheck;
    disk: DiskCheck;
  };
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkDatabase(): Promise<DatabaseCheck> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch {
    return { status: "error", latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<RedisCheck> {
  const start = Date.now();
  let redis: ReturnType<typeof createRedisConnection> | null = null;
  try {
    const config = getHubConfig();
    redis = createRedisConnection({ url: config.REDIS_URL, mode: "queue" });
    await redis.ping();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch {
    return { status: "error", latencyMs: Date.now() - start };
  } finally {
    try {
      await redis?.quit();
    } catch {
      // ignore quit errors
    }
  }
}

const ACTIVE_QUEUES = [
  QUEUE_NAMES.INGEST,
  QUEUE_NAMES.AI_GENERATION,
  QUEUE_NAMES.ASSET_COLLECTION,
  QUEUE_NAMES.QMS_VALIDATION,
  QUEUE_NAMES.RENDER_HEAVY,
  QUEUE_NAMES.GARBAGE_COLLECTION,
  QUEUE_NAMES.SCENE_ANALYSIS,
  QUEUE_NAMES.DEAD_LETTER,
] as const;

// Degradation thresholds
const RENDER_HEAVY_FAILED_THRESHOLD = 10;
const ANY_QUEUE_FAILED_THRESHOLD = 50;
const RENDER_HEAVY_WAITING_THRESHOLD = 100;

async function checkQueues(): Promise<QueuesCheck> {
  const config = getHubConfig();
  const connection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });

  try {
    const results = await Promise.allSettled(
      ACTIVE_QUEUES.map(async (name) => {
        const queue = new Queue(name, { connection });
        try {
          const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "failed",
            "delayed",
          );
          return { name, counts };
        } finally {
          await queue.close();
        }
      }),
    );

    const details: Record<string, QueueCounts> = {};
    let degraded = false;

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { name, counts } = result.value;
        details[name] = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };

        if (name === QUEUE_NAMES.RENDER_HEAVY) {
          if ((counts.failed ?? 0) > RENDER_HEAVY_FAILED_THRESHOLD)
            degraded = true;
          if ((counts.waiting ?? 0) > RENDER_HEAVY_WAITING_THRESHOLD)
            degraded = true;
        }
        if ((counts.failed ?? 0) > ANY_QUEUE_FAILED_THRESHOLD) degraded = true;
      }
    }

    return { status: degraded ? "degraded" : "ok", details };
  } finally {
    try {
      await connection.quit();
    } catch {
      // ignore
    }
  }
}

async function checkWorkers(): Promise<WorkersCheck> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  try {
    const staleRows = await db
      .select({ id: contentJobs.id })
      .from(contentJobs)
      .where(
        and(
          sql`${contentJobs.status} IN ('RENDERING_REMOTION', 'RENDERING_FFMPEG')`,
          lt(contentJobs.updated_at, twoHoursAgo),
        ),
      );

    const staleCount = staleRows.length;
    return {
      status: staleCount > 0 ? "degraded" : "ok",
      staleJobs: staleCount,
    };
  } catch {
    // If the DB is down the database check will catch it; don't double-count here
    return { status: "ok", staleJobs: 0 };
  }
}

const DISK_WARN_THRESHOLD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

async function checkDisk(): Promise<DiskCheck> {
  const config = getHubConfig();
  const mediaRoot = config.LOCAL_MEDIA_ROOT;

  try {
    const stats = await fs.statfs(mediaRoot);
    // bavail = free blocks available to unprivileged users; bsize = block size
    const availableBytes = stats.bavail * stats.bsize;
    const availableGb = Math.round((availableBytes / 1024 ** 3) * 10) / 10;

    return {
      status: availableBytes < DISK_WARN_THRESHOLD_BYTES ? "degraded" : "ok",
      availableGb,
    };
  } catch (err: unknown) {
    // Path doesn't exist (local dev) — skip gracefully
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { status: "skipped", availableGb: null };
    }
    // Any other FS error — still skip rather than reporting as 'error'
    // (disk errors surface at a lower level; this is a best-effort check)
    return { status: "skipped", availableGb: null };
  }
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

function deriveTopLevelStatus(
  checks: HealthResponse["checks"],
): TopLevelStatus {
  const statuses: CheckStatus[] = [
    checks.database.status,
    checks.redis.status,
    checks.queues.status,
    checks.workers.status,
    checks.disk.status,
  ];

  if (statuses.includes("error")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

// ─── Route handler ────────────────────────────────────────────────────────────

const HEALTH_CHECK_TIMEOUT_MS = 5000;

const TIMED_OUT_RESPONSE: HealthResponse = {
  status: "down",
  timestamp: "",
  checks: {
    database: { status: "error", latencyMs: -1 },
    redis: { status: "error", latencyMs: -1 },
    queues: { status: "ok", details: {} },
    workers: { status: "ok", staleJobs: 0 },
    disk: { status: "skipped", availableGb: null },
  },
};

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();

  const timeout = new Promise<HealthResponse>((resolve) =>
    setTimeout(
      () => resolve({ ...TIMED_OUT_RESPONSE, timestamp }),
      HEALTH_CHECK_TIMEOUT_MS,
    ),
  );

  const allChecks = async (): Promise<HealthResponse> => {
    const [database, redis, queues, workers, disk] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkQueues(),
      checkWorkers(),
      checkDisk(),
    ]);

    const checks = { database, redis, queues, workers, disk };
    const status = deriveTopLevelStatus(checks);

    return { status, timestamp, checks };
  };

  const result = await Promise.race([allChecks(), timeout]);

  // Return 503 for degraded/down (alerts monitoring), 200 only for fully healthy
  const httpStatus = result.status === "healthy" ? 200 : 503;

  return NextResponse.json(result, { status: httpStatus });
}
