/**
 * Provider registry — shared types.
 *
 * Vocabulary:
 *   Provider    An external service we can call (VUP, fastgen, Fish Audio…).
 *               Identified by a stable `key` slug that never changes.
 *   Capability  What a provider can produce (image, video, tts, llm, …).
 *   Chain       An ORDERED list of providers for one capability. Position 1
 *               is the primary; everything after it is a fallback and is
 *               individually toggleable — a disabled link is NEVER used, so
 *               fallback is opt-in rather than automatic.
 *   Consumer    Who is asking (a content format like TUTORIAL_STUDIO, or a
 *               subsystem like THUMBNAILS). Consumers carry priority and may
 *               override the global chain.
 */

// ── Capabilities ────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  "image",
  "video",
  "tts",
  "llm",
  "music",
  "footage",
  "storage",
  "other",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities that are routed through a chain (have fallback semantics). */
export const ROUTED_CAPABILITIES = [
  "image",
  "video",
  "tts",
  "llm",
  "music",
  "footage",
] as const;

export type RoutedCapability = (typeof ROUTED_CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Health verdict for a provider.
 *
 *   up        probed successfully
 *   degraded  probed successfully but slow / partially impaired
 *   down      probe failed (network error, non-2xx, timeout)
 *   expired   plan / licence is over — must NOT be used even if it answers
 *   disabled  operator switched it off
 *   no_key    the credential env var is not set on this host
 *   unknown   we have no safe way to probe it, or it has never been probed
 *
 * `unknown` is a first-class value on purpose: the UI shows it as "not
 * probed", never as a fake green.
 */
export const PROVIDER_STATUSES = [
  "up",
  "degraded",
  "down",
  "expired",
  "disabled",
  "no_key",
  "unknown",
] as const;

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export type PlanState =
  | "active"
  | "expired"
  | "trial"
  | "self_hosted"
  | "none"
  | "unknown";

export type CostTier = "free" | "cheap" | "standard" | "premium" | "unknown";

// ── Catalog (code-defined truth) ────────────────────────────────────────────

/**
 * How a provider can be health-probed.
 *
 *   none  — no safe/cheap probe exists. Status stays "unknown".
 *           (Explicitly modelled so the UI can say WHY it is unknown.)
 */
export interface ProbeSpec {
  kind: "http";
  /** Path appended to the resolved base URL, or a full URL. */
  path: string;
  method?: "GET" | "POST";
  /**
   * How the credential is presented.
   *   none            no auth header
   *   bearer          Authorization: Bearer <key>
   *   raw             Authorization: <key>
   *   x-api-key       X-API-Key: <key>
   *   header:<Name>   <Name>: <key>
   */
  auth?: "none" | "bearer" | "raw" | "x-api-key" | `header:${string}`;
  /** Extra static headers. */
  headers?: Record<string, string>;
  /** JSON body for POST probes. */
  body?: unknown;
  /** Latency above this = "degraded". */
  degradedAboveMs?: number;
  timeoutMs?: number;
  /**
   * Pull a human-readable detail (credits, quota, model count) out of the
   * probe response body. Must never throw.
   */
  extractDetail?: (body: unknown) => Record<string, unknown> | null;
  /** HTTP statuses that still count as "reachable" (e.g. 401 proves it's up). */
  okStatuses?: number[];
  /**
   * What a green actually proves. Some probes only prove the port is
   * listening, not that the credential works. Shown in the UI so "up" is
   * never over-read.
   */
  meaning?: string;
}

export interface ProviderDefinition {
  /** Stable slug. Also the join key used by chains + usage events. */
  key: string;
  displayName: string;
  vendor: string;
  description: string;
  capabilities: Capability[];
  /** Env var holding the credential. null = no credential needed. */
  keyEnvVar: string | null;
  /** Env var holding the base URL, if configurable. */
  urlEnvVar?: string | null;
  /** Env var holding the concurrency cap, if the code reads one. */
  concurrencyEnvVar?: string | null;
  defaultBaseUrl?: string | null;
  docsUrl?: string | null;
  costTier: CostTier;
  planState: PlanState;
  /** ISO date. Only meaningful when planState is "expired" or "trial". */
  planExpiresAt?: string | null;
  planNote?: string | null;
  /** Default in-flight cap the gateways apply. null = uncapped/unknown. */
  defaultMaxConcurrent: number | null;
  /** null = deliberately un-probeable; status stays "unknown". */
  probe: ProbeSpec | null;
  /** Why there is no probe — shown in the UI next to "unknown". */
  probeUnavailableReason?: string | null;
  /**
   * Env var naming a Netscape-format cookie FILE (yt-dlp). When set, the prober
   * stats the file and parses the earliest non-zero cookie expiry — an honest
   * probe for "the cookies are missing / about to lapse" without ever making a
   * download attempt. VERIFIED 2026-07-28: yt-dlp's file did not exist at all,
   * which this probe surfaces as `down` immediately.
   */
  cookieFileEnvVar?: string | null;
  /** Where in the codebase this provider is actually called from. */
  usedBy: string[];
  /**
   * For self-hosted providers: the pm2 process (or docker container) name on
   * the VPS. A crash-looping process shows up as a failing probe; this field
   * tells the operator WHERE to look. (forge-api sat crash-looping with 212+
   * restarts for days in July 2026 because nothing surfaced it.)
   */
  hostProcess?: string | null;
  /**
   * true when the code still references it but it is dead / superseded.
   * Surfaced loudly so dead integrations stop pretending to be options.
   */
  deprecated?: boolean;
  deprecationNote?: string | null;
  /**
   * Provider role.
   *   "routable" (default)  a real chain option the gateways may dispatch to
   *   "note"                visible for reference only — NEVER routable, and
   *                         must not render as red. Konrad's "keep as notes
   *                         only" verdict for openai / google_tts / inworld /
   *                         elevenlabs_official (§2.1). A note provider that
   *                         appears in a chain is reported ineligible with a
   *                         clear reason, never silently used.
   */
  role?: "routable" | "note";
  /**
   * true = this provider must never be chain position 1 / never serve a real
   * production render (edge_tts: "testing only", operator directive). The
   * gateway treats it as ineligible as a primary and surfaces the reason.
   */
  productionForbidden?: boolean;
  sortOrder?: number;
}

// ── Expiry clocks (Phase C / C1) ─────────────────────────────────────────────

/** The kind of clock a provider carries. A provider may have several. */
export type ExpiryKind =
  | "subscription"
  | "licence"
  | "api_key"
  | "cookie_file"
  | "oauth_token"
  | "credit_balance";

/** How an expiry was learned — NEVER "guessed". */
export type ExpirySource =
  | "manual"
  | "probe"
  | "file_mtime"
  | "cookie_parse"
  | "api";

export type ExpiryStatus = "ok" | "expiring_soon" | "expired" | "unknown";

export interface ProviderExpiry {
  providerKey: string;
  kind: ExpiryKind;
  label: string;
  /** null = unknown (source must then be "manual") — never fabricated. */
  expiresAt: string | null;
  source: ExpirySource;
  warnDaysBefore: number;
  lastVerifiedAt: string | null;
  evidence: Record<string, unknown> | null;
  note: string | null;
}

// ── Capability fallback policies (Phase B2) ──────────────────────────────────

export interface CapabilityPolicy {
  capability: RoutedCapability;
  /** null = global policy for the capability; else a consumer override. */
  consumer: string | null;
  /** Never fall back — throw with diagnostics when position 1 is ineligible. */
  strict: boolean;
  /** null = no depth cap. */
  maxFallbackDepth: number | null;
  requireAck: boolean;
}

// ── Chains ──────────────────────────────────────────────────────────────────

export interface ChainLink {
  capability: RoutedCapability;
  providerKey: string;
  /** 1 = primary, 2 = first fallback, … */
  position: number;
  /** Operator toggle. A disabled link is skipped entirely. */
  enabled: boolean;
  /** null = the global chain; otherwise a consumer-specific override chain. */
  consumer: string | null;
  note?: string | null;
}

export interface ConsumerPriority {
  consumer: string;
  /** null = applies to every capability. */
  capability: RoutedCapability | null;
  priority: number;
  /** Optional per-consumer in-flight cap. null = only the global cap applies. */
  maxConcurrent: number | null;
}

// ── Runtime state ───────────────────────────────────────────────────────────

export interface ProviderState {
  key: string;
  enabled: boolean;
  /** Operator override of the code default. null = use the default. */
  maxConcurrent: number | null;
  planState: PlanState;
  planExpiresAt: string | null;
  costTier: CostTier;
  notes: string | null;
}

export interface HealthResult {
  providerKey: string;
  status: ProviderStatus;
  latencyMs: number | null;
  httpStatus: number | null;
  detail: Record<string, unknown> | null;
  error: string | null;
  checkedAt: string;
}

/** Everything the UI and the gateways need, in one shot. */
export interface RegistrySnapshot {
  providers: ProviderDefinition[];
  states: Record<string, ProviderState>;
  links: ChainLink[];
  priorities: ConsumerPriority[];
  health: Record<string, HealthResult>;
  /**
   * Expiry clocks per provider (may be several per key). Optional so existing
   * callers / tests that build partial snapshots keep working; loadSnapshot
   * always populates it.
   */
  expiries?: ProviderExpiry[];
  /** Capability fallback policies (strict mode etc.). Optional, as above. */
  policies?: CapabilityPolicy[];
}

// ── Usage events ────────────────────────────────────────────────────────────

export type UsageOutcome = "success" | "error" | "skipped";

export interface ProviderUseEvent {
  capability: Capability;
  /** Content format or subsystem that asked. */
  consumer: string;
  /** The provider the chain WANTED (position 1 among enabled links). */
  requestedProvider: string | null;
  /** The provider that actually served the request. */
  servedProvider: string;
  /** true when servedProvider !== requestedProvider. */
  isFallback: boolean;
  /** 0 = primary, 1 = first fallback, … */
  fallbackDepth: number;
  outcome: UsageOutcome;
  latencyMs?: number | null;
  jobId?: string | null;
  context?: string | null;
  error?: string | null;
  /** Ordered list of providers attempted, for the "why" of a fallback. */
  attemptedChain?: string[] | null;
}
