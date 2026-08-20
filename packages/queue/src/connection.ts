import IoRedis from "ioredis";
import type { Redis as RedisClient } from "ioredis";

/**
 * Redis Connection Factory
 *
 * Creates IORedis connections for BullMQ.
 *
 * Design decisions:
 * - No singleton pattern - apps manage connection lifecycle
 * - Separate connections for Queue and Worker (BullMQ requirement)
 * - maxRetriesPerRequest: null (BullMQ compatibility requirement)
 * - enableReadyCheck: false (faster connection for workers)
 *
 * Usage:
 * ```typescript
 * const queueConnection = createRedisConnection(process.env.REDIS_URL);
 * const workerConnection = createRedisConnection(process.env.REDIS_URL);
 * ```
 */

export interface RedisConnectionOptions {
  /**
   * Redis connection URL
   * Format: redis://[:password@]host[:port][/db-number]
   * Example: redis://localhost:6379
   */
  url: string;

  /**
   * Connection mode
   * - 'queue': For Queue instances (add, remove, get jobs)
   * - 'worker': For Worker instances (process jobs)
   */
  mode?: "queue" | "worker";

  /**
   * Maximum reconnection attempts
   * Default: 10
   */
  maxRetriesPerRequest?: number | null;

  /**
   * Enable ready check before executing commands
   * Default: false for workers (faster startup)
   */
  enableReadyCheck?: boolean;
}

/**
 * Create Redis Connection
 *
 * Creates an IORedis client configured for BullMQ.
 *
 * @param options - Connection configuration
 * @returns IORedis client instance
 */
export function createRedisConnection(
  options: RedisConnectionOptions | string,
): RedisClient {
  // Handle simple string URL format
  if (typeof options === "string") {
    options = { url: options };
  }

  const {
    url,
    mode = "queue",
    maxRetriesPerRequest = null,
    enableReadyCheck = false,
  } = options;

  // Create IORedis instance with BullMQ-compatible config
  const connection = new IoRedis(url, {
    maxRetriesPerRequest,
    enableReadyCheck,
    // Additional sensible defaults
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ["READONLY", "ECONNREFUSED", "ETIMEDOUT"];
      return targetErrors.some((targetError) =>
        err.message.includes(targetError),
      );
    },
  });

  return connection;
}

/**
 * Close Redis Connection
 *
 * Gracefully closes a Redis connection.
 * Waits for pending commands to finish.
 *
 * @param connection - IORedis client to close
 */
export async function closeRedisConnection(
  connection: RedisClient,
): Promise<void> {
  await connection.quit();
}
