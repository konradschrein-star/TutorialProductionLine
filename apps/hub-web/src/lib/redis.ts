import Redis from "ioredis";
import { getHubConfig } from "./config";

/**
 * Redis connection singleton for Hub Web
 *
 * Used for:
 * - BullMQ queue inspection
 * - Session storage (future)
 * - Real-time pub/sub (if needed)
 */

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const config = getHubConfig();
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: true,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err: Error) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY error
          return true;
        }
        return false;
      },
    });

    redisClient.on("error", (err) => {
      console.error("[Redis] Connection error:", err);
    });

    redisClient.on("connect", () => {
      // Redis connected
    });
  }

  return redisClient;
}

/**
 * Graceful shutdown helper
 * Call this on SIGTERM/SIGINT to close connections cleanly
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
