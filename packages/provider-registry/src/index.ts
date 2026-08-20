/**
 * @repo/provider-registry
 *
 * One place that knows what external services Content Forge has, whether
 * they work, who is allowed to use them, and — critically — who ACTUALLY
 * served each request.
 *
 * Import surfaces:
 *   ./types    vocabulary
 *   ./catalog  code-defined truth about every provider
 *   ./resolve  pure routing / priority / concurrency / fallback logic
 *   ./probes   real health probes (no fake greens)
 *   ./store    persistence + operator mutations (pulls in drizzle)
 *   ./events   recordProviderUse() for gateway instrumentation
 *
 * `./resolve`, `./catalog`, `./types` and `./probes` are dependency-free
 * beyond fetch — import those directly on hot paths to avoid dragging in
 * the DB driver.
 */

export * from "./types.js";
export {
  BUILT_IN_PROVIDERS,
  PROVIDERS_BY_KEY,
  DEFAULT_CHAINS,
  KNOWN_CONSUMERS,
  type DefaultChainSpec,
} from "./catalog.js";
export {
  effectiveStatus,
  isUsable,
  resolveChain,
  eligibleProviders,
  primaryProvider,
  effectivePriority,
  resolveConcurrency,
  classifyOutcome,
  describeFallback,
  expiryClockStatus,
  providerExpiryStatus,
  resolvePolicy,
  applyPolicy,
  DEFAULT_CONSUMER_PRIORITIES,
  FALLBACK_PRIORITY,
  type ResolvedChainEntry,
  type ConcurrencyDecision,
  type FallbackVerdict,
  type AdmissibleChain,
} from "./resolve.js";
export {
  runProbe,
  runAllProbes,
  keyPresent,
  baseUrlFor,
  type EnvLike,
} from "./probes.js";
export {
  recordProviderUse,
  recordAttempt,
  flushProviderUse,
  disableUsageRecording,
  setUsageSink,
  type UsageSink,
} from "./events.js";
export {
  setRegistryDb,
  registryDb,
  syncCatalog,
  loadSnapshot,
  saveHealthResults,
  healthHistory,
  insertUsageEvents,
  recentFallbacks,
  recentUsage,
  usageRollup,
  capabilityOutcomes,
  SUSTAINED_FAILURE_MIN_ATTEMPTS,
  type CapabilityOutcome,
  setProviderEnabled,
  setProviderConcurrency,
  setLinkEnabled,
  setLinkPosition,
  setConsumerPriority,
  setCapabilityPolicy,
  upsertProviderExpiry,
  listComputeNodes,
  setComputeNodeEnabled,
  recordNodeHeartbeat,
  deriveNodeStatus,
  type UsageEventRow,
  type UsageRollup,
  type ComputeNodeView,
  type ComputeNodeDerivedStatus,
} from "./store.js";
