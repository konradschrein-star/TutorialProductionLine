import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@repo/queue';
import { getRedisClient } from '../redis';

/**
 * Queue Service
 *
 * Wraps BullMQ for queue inspection and metrics.
 * Used by dashboard and system health pages.
 */

export interface QueueMetrics {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Get metrics for a specific queue
 *
 * @param queueName - Queue name (e.g. 'queue:ingest')
 * @returns Queue metrics
 */
export async function getQueueMetrics(
  queueName: string
): Promise<QueueMetrics> {
  const redis = getRedisClient();
  const queue = new Queue(queueName, { connection: redis });

  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  const isPaused = await queue.isPaused();

  return {
    name: queueName,
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
    delayed: counts.delayed || 0,
    paused: isPaused,
  };
}

/**
 * Get metrics for all queues
 *
 * @returns Array of queue metrics
 */
export async function getAllQueueMetrics(): Promise<QueueMetrics[]> {
  const queueNames = [
    QUEUE_NAMES.INGEST,
    QUEUE_NAMES.AI_GENERATION,
    QUEUE_NAMES.ASSET_COLLECTION,
    QUEUE_NAMES.QMS_VALIDATION,
    QUEUE_NAMES.RENDER_HEAVY,
    QUEUE_NAMES.GARBAGE_COLLECTION,
    QUEUE_NAMES.SCENE_ANALYSIS,
  ];

  const metrics = await Promise.all(
    queueNames.map((name) => getQueueMetrics(name))
  );

  return metrics;
}

/**
 * Get total queue depth (sum of waiting + active across all queues)
 *
 * @returns Total queue depth
 */
export async function getTotalQueueDepth(): Promise<number> {
  const metrics = await getAllQueueMetrics();
  return metrics.reduce((sum, m) => sum + m.waiting + m.active, 0);
}
