/**
 * Scheduled provider prober (System Health plan, Phase A3).
 *
 * WHY THIS EXISTS: before this, health was only ever measured when a human
 * clicked "probe all" on the System Health page. There was no scheduler, so if
 * nobody clicked for a day every provider silently reverted to `unknown`
 * (loadSnapshot's old 24h window). This loop probes every catalog provider on
 * an interval and persists the results, so the page shows live health with no
 * human in the loop. The manual button still works.
 *
 * WHY IN THE WORKER, not hub-web: hub-web is request-scoped and its env is a
 * SUBSET of the worker's. The worker is long-lived and holds DATABASE_URL plus
 * every provider credential — so it is the only place a probe of, say, Fish or
 * DeepSeek can actually present a key. Credential presence on the System Health
 * page is therefore the WORKER's environment, not hub-web's (a seam the
 * Settings agent must respect).
 *
 * Safe by construction: runAllProbes never throws, probes never submit
 * generation work, and the loop swallows/logs its own errors so it can never
 * take the worker down.
 */

import {
  runAllProbes,
  saveHealthResults,
  syncCatalog,
  setRegistryDb,
} from "@repo/provider-registry";
import type { DrizzleClient } from "@repo/db";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

function log(
  level: "info" | "warn" | "error",
  message: string,
  extra?: object,
) {
  console.log(
    JSON.stringify({
      level,
      service: "provider-prober",
      message,
      ...extra,
      timestamp: new Date().toISOString(),
    }),
  );
}

export interface ProviderProberHandle {
  stop: () => void;
}

/**
 * Start the scheduled prober. Returns a handle whose `stop()` clears the timer
 * (call it from graceful shutdown). Runs one probe immediately, then every
 * `PROVIDER_PROBE_INTERVAL_MS` (default 300000).
 */
export function startProviderProber(opts: {
  db: DrizzleClient;
  env?: NodeJS.ProcessEnv;
}): ProviderProberHandle {
  const env = opts.env ?? process.env;
  const intervalMs =
    Number(env["PROVIDER_PROBE_INTERVAL_MS"]) || DEFAULT_INTERVAL_MS;

  // Share the worker's pooled client so the prober does not open its own.
  setRegistryDb(opts.db);

  let running = false;
  let catalogSynced = false;

  const tick = async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      if (!catalogSynced) {
        // Idempotent — makes the loop self-healing if the registry tables were
        // only just migrated in. Also seeds expiry clocks + fallback policies.
        await syncCatalog(opts.db);
        catalogSynced = true;
      }
      const results = await runAllProbes(env);
      await saveHealthResults(results, opts.db);
      const down = results.filter(
        (r) => r.status === "down" || r.status === "expired",
      ).length;
      log("info", "probe cycle complete", {
        probed: results.length,
        down_or_expired: down,
      });
    } catch (err) {
      // A missing registry table (0038/0043 not applied yet) lands here — log
      // and keep looping so the next cycle after a migration just works.
      log("warn", "probe cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };

  // Kick off immediately, then on the interval. unref() so the loop never keeps
  // the process alive on its own during shutdown.
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  log("info", "provider prober started", { interval_ms: intervalMs });

  return {
    stop: () => {
      clearInterval(timer);
      log("info", "provider prober stopped");
    },
  };
}
