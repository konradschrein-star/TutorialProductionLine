/**
 * Metrics module
 *
 * Provides Prometheus metrics collection and export.
 *
 * Usage:
 * ```ts
 * import { startMetricsCollection, recordRender } from '@/lib/metrics';
 *
 * // Start background metrics collection (call once at app startup)
 * startMetricsCollection();
 *
 * // Record custom metrics
 * recordRender('remotion', 'EXPLAINER', 'success', 45000);
 * ```
 */

export { registry } from "./registry";
export {
  updateQueueMetrics,
  updateSystemJobMetrics,
  updateDiskMetrics,
  updateAllSystemMetrics,
  recordRender,
  recordHttpRequest,
  recordAIGeneration,
} from "./collectors";

// Re-export specific metrics for direct access if needed
export {
  queueJobsWaiting,
  queueJobsActive,
  queueJobsFailed,
  queueJobsCompleted,
  queueJobDuration,
  renderDuration,
  renderTotal,
  renderActive,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
  systemJobsTotal,
  aiGenerationDuration,
  aiGenerationTotal,
} from "./registry";

import { updateAllSystemMetrics } from "./collectors";

let metricsInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic metrics collection
 *
 * Collects system metrics every 30 seconds.
 * Call this once at application startup.
 *
 * @param intervalMs - Collection interval in milliseconds (default: 30000)
 */
export function startMetricsCollection(intervalMs: number = 30000): void {
  if (metricsInterval) {
    console.warn("Metrics collection already started");
    return;
  }

  console.warn(`Starting metrics collection (interval: ${intervalMs}ms)`);

  // Collect metrics immediately
  updateAllSystemMetrics().catch((error) => {
    console.error("Failed to collect initial metrics:", error);
  });

  // Then collect periodically
  metricsInterval = setInterval(() => {
    updateAllSystemMetrics().catch((error) => {
      console.error("Failed to collect metrics:", error);
    });
  }, intervalMs);

  // Ensure cleanup on process exit
  process.on("SIGTERM", stopMetricsCollection);
  process.on("SIGINT", stopMetricsCollection);
}

/**
 * Stop periodic metrics collection
 *
 * Clears the collection interval.
 */
export function stopMetricsCollection(): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    console.warn("Stopped metrics collection");
  }
}
