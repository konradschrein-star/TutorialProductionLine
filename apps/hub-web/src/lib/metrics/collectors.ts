/**
 * Metrics collectors
 *
 * Utility functions to update Prometheus metrics from various parts of the application.
 */

import { Queue } from "bullmq";
import { createRedisConnection, QUEUE_NAMES } from "@repo/queue";
import { db, contentJobs } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getHubConfig } from "@/lib/config";
import { promises as fs } from "fs";
import {
  queueJobsWaiting,
  queueJobsActive,
  queueJobsFailed,
  systemJobsTotal,
  systemDiskUsage,
  systemDiskAvailable,
} from "./registry";

/**
 * Update queue metrics for all active queues
 *
 * Fetches job counts from Redis and updates Prometheus gauges.
 * Should be called periodically (e.g., every 30 seconds).
 */
export async function updateQueueMetrics(): Promise<void> {
  const config = getHubConfig();
  const connection = createRedisConnection({
    url: config.REDIS_URL,
    mode: "queue",
  });

  const activeQueues = [
    QUEUE_NAMES.INGEST,
    QUEUE_NAMES.AI_GENERATION,
    QUEUE_NAMES.ASSET_COLLECTION,
    QUEUE_NAMES.QMS_VALIDATION,
    QUEUE_NAMES.RENDER_HEAVY,
    QUEUE_NAMES.GARBAGE_COLLECTION,
    QUEUE_NAMES.SCENE_ANALYSIS,
    QUEUE_NAMES.DEAD_LETTER,
  ];

  try {
    await Promise.all(
      activeQueues.map(async (queueName) => {
        const queue = new Queue(queueName, { connection });
        try {
          const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "failed",
          );

          queueJobsWaiting.set({ queue: queueName }, counts.waiting ?? 0);
          queueJobsActive.set({ queue: queueName }, counts.active ?? 0);
          queueJobsFailed.set({ queue: queueName }, counts.failed ?? 0);
        } finally {
          await queue.close();
        }
      }),
    );
  } finally {
    await connection.quit();
  }
}

/**
 * Update system job count metrics
 *
 * Fetches job counts by status from database and updates Prometheus gauges.
 * Should be called periodically (e.g., every 60 seconds).
 */
export async function updateSystemJobMetrics(): Promise<void> {
  try {
    // Get job counts grouped by status
    const statusCounts = await db
      .select({
        status: contentJobs.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(contentJobs)
      .groupBy(contentJobs.status);

    // Update gauge for each status
    for (const { status, count } of statusCounts) {
      systemJobsTotal.set({ status }, count);
    }
  } catch (error) {
    console.error("Failed to update system job metrics:", error);
  }
}

/**
 * Update disk usage metrics
 *
 * Checks disk space on LOCAL_MEDIA_ROOT and updates Prometheus gauges.
 * Should be called periodically (e.g., every 120 seconds).
 */
export async function updateDiskMetrics(): Promise<void> {
  const config = getHubConfig();
  const mediaRoot = config.LOCAL_MEDIA_ROOT;

  try {
    const stats = await fs.statfs(mediaRoot);

    // Calculate total and available bytes
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - availableBytes;

    systemDiskUsage.set({ mount: mediaRoot }, usedBytes);
    systemDiskAvailable.set({ mount: mediaRoot }, availableBytes);
  } catch (error) {
    // Disk metrics are best-effort; don't fail if unavailable
    console.error("Failed to update disk metrics:", error);
  }
}

/**
 * Update all system metrics
 *
 * Convenience function to update all metrics in one call.
 * Useful for periodic background updates.
 */
export async function updateAllSystemMetrics(): Promise<void> {
  await Promise.allSettled([
    updateQueueMetrics(),
    updateSystemJobMetrics(),
    updateDiskMetrics(),
  ]);
}

/**
 * Record render operation
 *
 * Updates render metrics when a render completes.
 *
 * @param engine - Render engine used (ffmpeg or remotion)
 * @param format - Content format (e.g., EXPLAINER)
 * @param status - Render status (success or failed)
 * @param durationMs - Render duration in milliseconds
 */
export function recordRender(
  engine: "ffmpeg" | "remotion",
  format: string,
  status: "success" | "failed",
  durationMs: number,
): void {
  const { renderDuration, renderTotal } = require("./registry");

  renderTotal.inc({ engine, format, status });
  renderDuration.observe({ engine, format, status }, durationMs / 1000);
}

/**
 * Record API request
 *
 * Updates HTTP metrics when a request completes.
 *
 * @param method - HTTP method
 * @param path - Request path
 * @param status - HTTP status code
 * @param durationMs - Request duration in milliseconds
 */
export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
): void {
  const { httpRequestsTotal, httpRequestDuration } = require("./registry");

  httpRequestsTotal.inc({ method, path, status: status.toString() });
  httpRequestDuration.observe(
    { method, path, status: status.toString() },
    durationMs / 1000,
  );
}

/**
 * Record AI generation operation
 *
 * Updates AI metrics when an AI operation completes.
 *
 * @param operation - Operation type (e.g., script, tts, thumbnail)
 * @param provider - AI provider (e.g., anthropic, elevenlabs)
 * @param status - Operation status (success or failed)
 * @param durationMs - Operation duration in milliseconds
 * @param tokensUsed - Optional token count
 */
export function recordAIGeneration(
  operation: string,
  provider: string,
  status: "success" | "failed",
  durationMs: number,
  tokensUsed?: number,
): void {
  const {
    aiGenerationDuration,
    aiGenerationTotal,
    aiGenerationTokensUsed,
  } = require("./registry");

  aiGenerationTotal.inc({ operation, provider, status });
  aiGenerationDuration.observe(
    { operation, provider, status },
    durationMs / 1000,
  );

  if (tokensUsed !== undefined) {
    aiGenerationTokensUsed.inc({ provider, model: "default" }, tokensUsed);
  }
}
