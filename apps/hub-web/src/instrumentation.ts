/**
 * Next.js Instrumentation Hook
 *
 * This file runs once when the Next.js server starts up (not on every request).
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.warn("[instrumentation] Content Forge Hub starting...");
  }
}
