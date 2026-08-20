/**
 * Bridge between the gateways and @repo/provider-registry.
 *
 * Two jobs:
 *
 *  1. GATE — skip backends the operator switched off, and backends whose
 *     plan has expired. This is what makes fallback opt-in instead of
 *     automatic. fastgen ships disabled here, so the Nano-Banana-2 →
 *     Seedream downgrade path is closed by configuration rather than by
 *     someone remembering.
 *
 *  2. REPORT — record who actually served each request, flagged when it was
 *     not the primary.
 *
 * Failure policy is deliberately asymmetric:
 *   - Cannot load the registry (no DB, not migrated, boot race)? FAIL OPEN.
 *     Routing behaves exactly as it did before this file existed. A broken
 *     observability layer must never stop production.
 *   - Registry loaded and says a backend is off/expired? FAIL CLOSED. An
 *     explicit "no" is honoured.
 *
 * The snapshot is cached and refreshed in the background, so the routing
 * path stays synchronous and never awaits the database.
 */

import {
  effectiveStatus,
  isUsable,
  keyPresent,
  PROVIDERS_BY_KEY,
  recordAttempt,
  type Capability,
  type ProviderStatus,
  type RegistrySnapshot,
  type UsageOutcome,
} from "@repo/provider-registry";

const REFRESH_MS = 60_000;

let snapshot: RegistrySnapshot | null = null;
let lastAttempt = 0;
let refreshing = false;
/** Set once loading has failed, so we stop hammering a DB that isn't there. */
let loadFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

function scheduleRefresh(): void {
  if (refreshing) return;
  if (loadFailures >= MAX_CONSECUTIVE_FAILURES && snapshot === null) return;
  const now = Date.now();
  if (now - lastAttempt < REFRESH_MS) return;
  lastAttempt = now;
  refreshing = true;
  void (async () => {
    try {
      const { loadSnapshot } = await import("@repo/provider-registry");
      snapshot = await loadSnapshot();
      loadFailures = 0;
    } catch (err) {
      loadFailures++;
      if (loadFailures === 1) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "provider-registry snapshot unavailable — gateway routing is UNGATED (fail-open)",
            error:
              err instanceof Error ? err.message.slice(0, 200) : String(err),
          }),
        );
      }
    } finally {
      refreshing = false;
    }
  })();
}

/** Prime the cache at boot so the first request is already gated. */
export function initProviderRegistryBridge(): void {
  scheduleRefresh();
}

/**
 * Status of a backend according to the registry, or null when the registry
 * has nothing to say (not loaded, or provider not in the catalog).
 */
function statusOf(providerKey: string): ProviderStatus | null {
  scheduleRefresh();
  if (!snapshot) return null;
  const definition = PROVIDERS_BY_KEY.get(providerKey);
  if (!definition) return null;
  return effectiveStatus({
    definition,
    state: snapshot.states[providerKey],
    health: snapshot.health[providerKey],
    keyPresent: keyPresent(definition, process.env),
  });
}

/**
 * Is this capability hop switched off for this backend?
 *
 * Returns false (allow) whenever the registry cannot answer — fail open.
 */
export function isBackendBlocked(
  capability: Capability,
  providerKey: string,
): boolean {
  const status = statusOf(providerKey);
  if (status === null) return false; // registry silent → allow
  if (!isUsable(status)) return true; // expired / disabled / no_key / down

  const links = snapshot?.links.filter(
    (l) =>
      l.capability === capability &&
      l.providerKey === providerKey &&
      l.consumer === null,
  );
  // No link modelled for this hop → the registry has no opinion, allow it.
  if (!links || links.length === 0) return false;
  return !links.some((l) => l.enabled);
}

/** Why a backend was skipped, for logs. Never invented. */
export function blockReason(
  capability: Capability,
  providerKey: string,
): string | null {
  const status = statusOf(providerKey);
  if (status === null) return null;
  if (!isUsable(status)) return `provider ${status}`;
  const link = snapshot?.links.find(
    (l) =>
      l.capability === capability &&
      l.providerKey === providerKey &&
      l.consumer === null,
  );
  if (link && !link.enabled) return "chain link disabled by operator";
  return null;
}

/**
 * Record a completed attempt. Fire-and-forget; never throws.
 *
 * `chain` is the ordered list of backends that were actually candidates for
 * this request. Anything served from position > 0 is a fallback and shows up
 * on the System Health page.
 */
export function reportProviderUse(input: {
  capability: Capability;
  consumer: string;
  chain: string[];
  servedProvider: string;
  pinned?: boolean;
  outcome: UsageOutcome;
  latencyMs?: number;
  context?: string | null;
  error?: string | null;
}): void {
  try {
    recordAttempt({
      capability: input.capability,
      consumer: input.consumer,
      chain: input.chain,
      servedProvider: input.servedProvider,
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      outcome: input.outcome,
      latencyMs: input.latencyMs ?? null,
      context: input.context ?? null,
      error: input.error ?? null,
    });
  } catch {
    // Observability must never be able to fail a render.
  }
}
