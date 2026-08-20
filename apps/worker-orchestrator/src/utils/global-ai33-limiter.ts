/**
 * Global AI33 Rate Limiter
 *
 * Shared singleton across all TTS jobs to prevent exceeding AI33's
 * 50-task queue limit. Without this, multiple concurrent jobs can
 * overwhelm the API (8 jobs × 3 chunks = 24+ concurrent calls).
 *
 * This limits TOTAL concurrent AI33 API calls across all jobs to 15,
 * leaving headroom for the AI33 queue and ensuring reliable processing.
 */

import { AdaptiveRateLimiter } from "./adaptive-rate-limiter.js";

/**
 * Global singleton instance shared by all TTS generation jobs.
 *
 * Configuration:
 * - Initial concurrency: 10 (conservative start)
 * - Min concurrency: 5 (floor to maintain throughput)
 * - Max concurrency: 15 (well under AI33's 50-task limit)
 * - Ramps up on success, backs off on 429 errors
 */
export const globalAI33Limiter = new AdaptiveRateLimiter({
  initialConcurrency: 10,
  minConcurrency: 5,
  maxConcurrency: 15,
  successesBeforeRampUp: 10,
  rateLimitsBeforeRampDown: 2,
});

/**
 * Execute an AI33 API call through the global rate limiter.
 *
 * Usage:
 * ```ts
 * const audioBuffer = await executeWithGlobalAI33Limit(() =>
 *   ttsProvider.generateChunk(text, voiceId)
 * );
 * ```
 */
export async function executeWithGlobalAI33Limit<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return globalAI33Limiter.execute(fn);
}

/**
 * Get current global AI33 limiter stats for observability.
 */
export function getGlobalAI33LimiterStats() {
  return {
    currentConcurrency: globalAI33Limiter.currentConcurrency,
    activeRequests: globalAI33Limiter.activeRequests,
  };
}
