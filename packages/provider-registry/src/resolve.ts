/**
 * Pure resolution logic — no I/O, no DB, no env reads beyond what is passed in.
 *
 * This is the part that decides:
 *   - which providers are eligible for a capability, in what order
 *   - what priority a consumer gets
 *   - what concurrency cap applies
 *   - whether a completed request used a fallback, and how deep
 *
 * All of it is deterministic and unit-tested. The gateways call these
 * functions; they do not re-implement routing.
 */

import type {
  CapabilityPolicy,
  ChainLink,
  ConsumerPriority,
  ExpiryStatus,
  HealthResult,
  ProviderDefinition,
  ProviderExpiry,
  ProviderState,
  ProviderStatus,
  RegistrySnapshot,
  RoutedCapability,
} from "./types.js";

// ── Expiry clocks (Phase C / C1) ─────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Status of a single expiry clock. NEVER guesses: a null expiry date is
 * "unknown" (the operator must supply it), not "ok".
 */
export function expiryClockStatus(
  expiry: Pick<ProviderExpiry, "expiresAt" | "warnDaysBefore">,
  now: Date = new Date(),
): ExpiryStatus {
  if (!expiry.expiresAt) return "unknown";
  const ms = new Date(expiry.expiresAt).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= now.getTime()) return "expired";
  if (ms - now.getTime() <= expiry.warnDaysBefore * DAY_MS)
    return "expiring_soon";
  return "ok";
}

/**
 * Worst status across every clock a provider carries. "expired" beats
 * "expiring_soon" beats "ok"; "unknown" clocks are informational and never
 * downgrade a provider on their own (a missing date is a prompt, not a fault).
 */
export function providerExpiryStatus(
  expiries: ProviderExpiry[],
  providerKey: string,
  now: Date = new Date(),
): ExpiryStatus {
  const mine = expiries.filter((e) => e.providerKey === providerKey);
  if (mine.length === 0) return "unknown";
  let worst: ExpiryStatus = "unknown";
  const rank: Record<ExpiryStatus, number> = {
    ok: 1,
    unknown: 0,
    expiring_soon: 2,
    expired: 3,
  };
  for (const e of mine) {
    const s = expiryClockStatus(e, now);
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

// ── Provider status ─────────────────────────────────────────────────────────

/**
 * Effective status of a provider, combining operator state, plan state,
 * credential presence, and the last probe.
 *
 * Precedence (most decisive first):
 *   expired  > disabled > no_key > last probe > unknown
 *
 * "expired" wins over everything because an expired plan must never be used
 * even if the endpoint still answers 200 — that is exactly how fastgen kept
 * silently serving requests after 2026-07-21.
 */
export function effectiveStatus(input: {
  definition: ProviderDefinition;
  state?: ProviderState | undefined;
  health?: HealthResult | undefined;
  /** Whether the credential env var is actually set on this host. */
  keyPresent: boolean;
  /**
   * Expiry clocks for THIS provider (Phase C). An expired clock (a lapsed
   * subscription, a dead cookie file, a burned api key) forces "expired" even
   * when the endpoint still answers 200 — the generic version of the fastgen
   * grievance. "expiring_soon" only warns; it never blocks here.
   */
  expiries?: ProviderExpiry[];
  /** Compared against planExpiresAt / expiry clocks. Defaults to now. */
  now?: Date;
}): ProviderStatus {
  const { definition, state, health, keyPresent } = input;
  const now = input.now ?? new Date();

  const planState = state?.planState ?? definition.planState;
  const expiresAt = state?.planExpiresAt ?? definition.planExpiresAt ?? null;

  if (planState === "expired") return "expired";
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }

  // Generic expiry clocks outrank a live probe, same as planExpiresAt.
  if (
    input.expiries &&
    providerExpiryStatus(input.expiries, definition.key, now) === "expired"
  ) {
    return "expired";
  }

  const enabled = state?.enabled ?? true;
  if (!enabled) return "disabled";

  if (definition.keyEnvVar && !keyPresent) return "no_key";

  if (health) return health.status;
  return "unknown";
}

/** A provider that may actually be dispatched to right now. */
export function isUsable(status: ProviderStatus): boolean {
  return status === "up" || status === "degraded" || status === "unknown";
}

// ── Chain resolution ────────────────────────────────────────────────────────

export interface ResolvedChainEntry {
  providerKey: string;
  position: number;
  /** Link toggle (operator opt-in for this hop). */
  linkEnabled: boolean;
  status: ProviderStatus;
  /** Eligible = link enabled AND status usable. */
  eligible: boolean;
  /** Why it is not eligible — for the UI, never guessed. */
  ineligibleReason: string | null;
}

/**
 * Resolve the ordered chain for a capability + consumer.
 *
 * Consumer-specific links REPLACE the global chain for that capability when
 * any exist (so a format can have a completely different chain), otherwise
 * the global chain (consumer === null) is used.
 *
 * The result is the full chain annotated with eligibility — the UI renders
 * every hop including the blocked ones, which is the whole point.
 */
export function resolveChain(
  snapshot: Pick<
    RegistrySnapshot,
    "links" | "providers" | "states" | "health" | "expiries"
  >,
  capability: RoutedCapability,
  consumer: string | null,
  opts: { keyPresent: (providerKey: string) => boolean; now?: Date },
): ResolvedChainEntry[] {
  const forCapability = snapshot.links.filter(
    (l) => l.capability === capability,
  );
  const consumerLinks = consumer
    ? forCapability.filter((l) => l.consumer === consumer)
    : [];
  const chosen =
    consumerLinks.length > 0
      ? consumerLinks
      : forCapability.filter((l) => l.consumer === null);

  const byKey = new Map(snapshot.providers.map((p) => [p.key, p]));

  return [...chosen]
    .sort(
      (a, b) =>
        a.position - b.position || a.providerKey.localeCompare(b.providerKey),
    )
    .map((link) => {
      const definition = byKey.get(link.providerKey);
      if (!definition) {
        return {
          providerKey: link.providerKey,
          position: link.position,
          linkEnabled: link.enabled,
          status: "unknown" as ProviderStatus,
          eligible: false,
          ineligibleReason: "provider not in catalog",
        };
      }
      const status = effectiveStatus({
        definition,
        state: snapshot.states[link.providerKey],
        health: snapshot.health[link.providerKey],
        keyPresent: opts.keyPresent(link.providerKey),
        ...(snapshot.expiries ? { expiries: snapshot.expiries } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
      const usable = isUsable(status);
      // A "note" provider is reference-only and is NEVER dispatched to, even if
      // it happens to sit in a chain. A production-forbidden provider (edge_tts)
      // may never be the primary. Both are reported, never silently skipped.
      const isNote = definition.role === "note";
      const forbiddenPrimary =
        definition.productionForbidden === true && link.position === 1;
      const eligible = link.enabled && usable && !isNote && !forbiddenPrimary;
      let ineligibleReason: string | null = null;
      if (!link.enabled) ineligibleReason = "fallback link switched off";
      else if (isNote) ineligibleReason = "reference-only (note), not routable";
      else if (forbiddenPrimary)
        ineligibleReason = "forbidden as primary (testing-only provider)";
      else if (!usable) ineligibleReason = `provider ${status}`;
      return {
        providerKey: link.providerKey,
        position: link.position,
        linkEnabled: link.enabled,
        status,
        eligible,
        ineligibleReason,
      };
    });
}

/** Just the provider keys that may be dispatched to, in order. */
export function eligibleProviders(chain: ResolvedChainEntry[]): string[] {
  return chain.filter((e) => e.eligible).map((e) => e.providerKey);
}

/** The provider the chain WANTS — first eligible hop, or null if none. */
export function primaryProvider(chain: ResolvedChainEntry[]): string | null {
  return chain.find((e) => e.eligible)?.providerKey ?? null;
}

// ── Priority ────────────────────────────────────────────────────────────────

/**
 * Built-in consumer priorities. Higher = served first.
 * Mirrors the gateway tables so behaviour is unchanged until an operator
 * overrides something in the UI.
 */
export const DEFAULT_CONSUMER_PRIORITIES: Record<string, number> = {
  TUTORIAL_STUDIO: 120,
  THUMBNAILS: 110,
  CASUALLY_EXPLAINED: 100,
  EXPLAINER: 80,
  POLITICAL_COMMENTARY_REACTOR: 80,
  TECH_COMPARISON: 60,
  RANKING: 60,
  LONG_FORM_DRAMA: 50,
  DOCUMENTARY: 50,
  VIDEO_ESSAY: 50,
  BUNDESTAG: 50,
  CLIP_FORGE: 45,
  OTHER: 40,
  STOCK_LIBRARY: 30,
};

export const FALLBACK_PRIORITY = 40;

/**
 * Effective priority for a consumer.
 *
 * Precedence: capability-specific override → consumer-wide override →
 * built-in default → FALLBACK_PRIORITY.
 */
export function effectivePriority(
  priorities: ConsumerPriority[],
  consumer: string,
  capability: RoutedCapability | null,
): number {
  if (capability) {
    const specific = priorities.find(
      (p) => p.consumer === consumer && p.capability === capability,
    );
    if (specific) return specific.priority;
  }
  const wide = priorities.find(
    (p) => p.consumer === consumer && p.capability === null,
  );
  if (wide) return wide.priority;
  return DEFAULT_CONSUMER_PRIORITIES[consumer] ?? FALLBACK_PRIORITY;
}

// ── Concurrency ─────────────────────────────────────────────────────────────

export interface ConcurrencyDecision {
  /** Effective global cap for the provider. null = uncapped. */
  cap: number | null;
  /** Whether a new request may start given current in-flight count. */
  admit: boolean;
  /** Where the cap came from — shown in the UI so it isn't magic. */
  source: "operator" | "catalog" | "uncapped";
}

/**
 * Resolve the concurrency cap for a provider and decide admission.
 *
 * The cap is GLOBAL to the provider, not per-format — that is the whole
 * point: formats share one pool instead of fighting for it. A per-consumer
 * cap, when configured, additionally bounds that one consumer's share and
 * can only ever be more restrictive.
 */
export function resolveConcurrency(input: {
  definition: ProviderDefinition;
  state?: ProviderState | undefined;
  inFlight: number;
  /** Optional per-consumer sub-cap and that consumer's current in-flight. */
  consumerCap?: number | null;
  consumerInFlight?: number;
}): ConcurrencyDecision {
  const operator = input.state?.maxConcurrent ?? null;
  const cap = operator ?? input.definition.defaultMaxConcurrent;
  const source: ConcurrencyDecision["source"] =
    operator != null ? "operator" : cap != null ? "catalog" : "uncapped";

  let admit = cap == null || input.inFlight < cap;
  if (
    admit &&
    input.consumerCap != null &&
    (input.consumerInFlight ?? 0) >= input.consumerCap
  ) {
    admit = false;
  }
  return { cap, admit, source };
}

// ── Fallback detection ──────────────────────────────────────────────────────

export interface FallbackVerdict {
  isFallback: boolean;
  /** 0 = the chain's primary served it. */
  fallbackDepth: number;
  requestedProvider: string | null;
  servedProvider: string;
  /**
   * true when the served provider is not in the chain at all — a hard-coded
   * bypass. Louder than a normal fallback, because it means routing was
   * decided somewhere other than the registry.
   */
  offChain: boolean;
}

/**
 * Classify a completed request against the chain it was routed through.
 *
 * This is the Nano-Banana-2 → Seedream detector. It answers "did we get what
 * we asked for?" and is called on EVERY gateway completion, so a silent
 * downgrade becomes a row in provider_usage_events with is_fallback = true.
 *
 * `chain` is the ordered list of provider keys that were eligible at
 * dispatch time (see eligibleProviders). `pinned` marks requests where the
 * caller explicitly pinned a backend — those are not fallbacks even if the
 * pin is not the chain primary.
 */
export function classifyOutcome(input: {
  chain: string[];
  servedProvider: string;
  pinned?: boolean;
}): FallbackVerdict {
  const { chain, servedProvider } = input;
  const requestedProvider = chain[0] ?? null;
  const idx = chain.indexOf(servedProvider);

  if (input.pinned) {
    return {
      isFallback: false,
      fallbackDepth: 0,
      requestedProvider: servedProvider,
      servedProvider,
      offChain: idx === -1,
    };
  }

  if (idx === -1) {
    return {
      isFallback: true,
      // Off-chain: it is at least one hop past everything we knew about.
      fallbackDepth: chain.length > 0 ? chain.length : 1,
      requestedProvider,
      servedProvider,
      offChain: true,
    };
  }

  return {
    isFallback: idx > 0,
    fallbackDepth: idx,
    requestedProvider,
    servedProvider,
    offChain: false,
  };
}

// ── Capability policy (Phase B2 — "fail instead of degrading") ───────────────

/**
 * Effective policy for a capability + consumer. A consumer-specific policy
 * wins; otherwise the global (consumer === null) policy applies; otherwise the
 * permissive default (fallback allowed, no depth cap).
 */
export function resolvePolicy(
  policies: CapabilityPolicy[],
  capability: RoutedCapability,
  consumer: string | null,
): CapabilityPolicy {
  const consumerPolicy = consumer
    ? policies.find(
        (p) => p.capability === capability && p.consumer === consumer,
      )
    : undefined;
  if (consumerPolicy) return consumerPolicy;
  const global = policies.find(
    (p) => p.capability === capability && p.consumer === null,
  );
  if (global) return global;
  return {
    capability,
    consumer,
    strict: false,
    maxFallbackDepth: null,
    requireAck: false,
  };
}

export interface AdmissibleChain {
  /** Provider keys the gateway may try, in order, AFTER policy is applied. */
  order: string[];
  /**
   * Set when policy forbids serving this request. The gateway MUST throw with
   * this diagnostic rather than degrade — this is the whole point of strict
   * mode. null = the request may proceed with `order`.
   */
  blockedReason: string | null;
}

/**
 * Apply a capability policy to a resolved chain, returning the providers the
 * gateway is allowed to attempt and — critically — a `blockedReason` when the
 * policy says to fail instead of degrade.
 *
 * `strict` means: only ever use the FIRST chain position. If position 1 is not
 * eligible, the request is blocked with the full chain in the reason (each hop
 * + why it was ineligible), never quietly downgraded. `maxFallbackDepth` caps
 * how far a non-strict fallback may reach.
 */
export function applyPolicy(
  chain: ResolvedChainEntry[],
  policy: CapabilityPolicy,
): AdmissibleChain {
  const eligible = chain.filter((e) => e.eligible);

  const diag = () =>
    chain
      .map(
        (e) =>
          `#${e.position} ${e.providerKey}=${e.status}` +
          (e.eligible ? "(eligible)" : `(${e.ineligibleReason ?? "blocked"})`),
      )
      .join(", ");

  if (policy.strict) {
    // Only position 1 may serve. It must be the eligible primary.
    const first = chain.find(
      (e) => e.position === Math.min(...chain.map((c) => c.position)),
    );
    if (!first || !first.eligible) {
      return {
        order: [],
        blockedReason:
          `strict policy for ${policy.capability}` +
          (policy.consumer ? ` / ${policy.consumer}` : "") +
          `: primary not eligible, fallback disabled. Chain: ${diag()}`,
      };
    }
    return { order: [first.providerKey], blockedReason: null };
  }

  if (eligible.length === 0) {
    return {
      order: [],
      blockedReason: `no eligible provider for ${policy.capability}. Chain: ${diag()}`,
    };
  }

  const capped =
    policy.maxFallbackDepth != null
      ? eligible.slice(0, policy.maxFallbackDepth + 1)
      : eligible;
  return { order: capped.map((e) => e.providerKey), blockedReason: null };
}

/** Human sentence for the fallback banner. Never invented — pure formatting. */
export function describeFallback(v: FallbackVerdict): string {
  if (!v.isFallback) return `served by ${v.servedProvider} (primary)`;
  if (v.offChain) {
    return `wanted ${v.requestedProvider ?? "(no eligible provider)"}, got ${v.servedProvider} — OFF-CHAIN, routing bypassed the registry`;
  }
  return `wanted ${v.requestedProvider}, got ${v.servedProvider} (fallback #${v.fallbackDepth})`;
}
