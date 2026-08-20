/**
 * `recordProviderUse()` — the instrumentation entry point for the gateways.
 *
 * Design rules (mirrors spend-reporter.ts, which is the pattern this repo
 * already trusts on hot paths):
 *   - Never throws, never blocks the caller. Observability must not be able
 *     to fail a render.
 *   - Buffered: events accumulate for up to FLUSH_MS or BATCH_MAX and are
 *     written in one INSERT.
 *   - Degrades to a console line when the DB is unreachable, so the signal
 *     is not lost entirely.
 *
 * Everything routed through a gateway calls this exactly once per completed
 * attempt. A fallback therefore always leaves a row with is_fallback = true —
 * which is the whole point.
 */

import type { ProviderUseEvent } from "./types.js";
import { classifyOutcome, type FallbackVerdict } from "./resolve.js";

const FLUSH_MS = 2_000;
const BATCH_MAX = 25;

let buffer: ProviderUseEvent[] = [];
let timer: NodeJS.Timeout | null = null;
let disabled = false;

/** Turn persistence off (tests, or a host with no DATABASE_URL). */
export function disableUsageRecording(): void {
  disabled = true;
}

/** Swap the sink — used by tests and by hosts that want a custom writer. */
export type UsageSink = (events: ProviderUseEvent[]) => Promise<void>;
let sink: UsageSink | null = null;
export function setUsageSink(fn: UsageSink | null): void {
  sink = fn;
}

/** Drain the buffer immediately. Never throws. */
export async function flushProviderUse(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    if (sink) {
      await sink(batch);
      return;
    }
    // Imported lazily so a consumer that only wants the pure logic never
    // drags in drizzle/postgres.
    const { insertUsageEvents } = await import("./store.js");
    await insertUsageEvents(batch);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "provider-registry: failed to persist usage events",
        dropped: batch.length,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        // Emit the fallbacks to the log so the signal survives a DB outage.
        fallbacks: batch
          .filter((e) => e.isFallback)
          .map(
            (e) =>
              `${e.consumer}/${e.capability}: wanted ${e.requestedProvider} got ${e.servedProvider}`,
          ),
      }),
    );
  }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushProviderUse();
  }, FLUSH_MS);
  // Do not hold the process open just to flush observability.
  timer.unref?.();
}

/**
 * Record one completed provider attempt. Fire-and-forget.
 *
 * A fallback is additionally logged immediately at warn level — the operator
 * should be able to see it in `pm2 logs` without opening the UI.
 */
export function recordProviderUse(event: ProviderUseEvent): void {
  if (event.isFallback) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "provider-registry: FALLBACK USED",
        capability: event.capability,
        consumer: event.consumer,
        wanted: event.requestedProvider,
        got: event.servedProvider,
        depth: event.fallbackDepth,
        context: event.context ?? null,
        job_id: event.jobId ?? null,
      }),
    );
  }
  if (disabled) return;
  buffer.push(event);
  if (buffer.length >= BATCH_MAX) {
    void flushProviderUse();
    return;
  }
  schedule();
}

/**
 * Convenience wrapper: classify against the chain and record in one call.
 * This is what the gateways use so classification can never drift from
 * recording.
 */
export function recordAttempt(input: {
  capability: ProviderUseEvent["capability"];
  consumer: string;
  chain: string[];
  servedProvider: string;
  pinned?: boolean;
  outcome: ProviderUseEvent["outcome"];
  latencyMs?: number | null;
  jobId?: string | null;
  context?: string | null;
  error?: string | null;
}): FallbackVerdict {
  const verdict = classifyOutcome({
    chain: input.chain,
    servedProvider: input.servedProvider,
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
  });
  recordProviderUse({
    capability: input.capability,
    consumer: input.consumer,
    requestedProvider: verdict.requestedProvider,
    servedProvider: verdict.servedProvider,
    isFallback: verdict.isFallback,
    fallbackDepth: verdict.fallbackDepth,
    outcome: input.outcome,
    latencyMs: input.latencyMs ?? null,
    jobId: input.jobId ?? null,
    context: input.context ?? null,
    error: input.error ?? null,
    attemptedChain: input.chain.length > 0 ? input.chain : null,
  });
  return verdict;
}
