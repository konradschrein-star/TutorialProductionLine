import {
  baseUrlFor,
  effectivePriority,
  effectiveStatus,
  expiryClockStatus,
  keyPresent,
  KNOWN_CONSUMERS,
  providerExpiryStatus,
  resolveChain,
  ROUTED_CAPABILITIES,
  type ExpiryStatus,
  type ProviderDefinition,
  type ProviderExpiry,
  type ProviderStatus,
  type RegistrySnapshot,
  type ResolvedChainEntry,
  type RoutedCapability,
  type UsageRollup,
} from "@repo/provider-registry";

/**
 * Turns a raw registry snapshot into exactly what the page renders.
 *
 * Everything here is derived — nothing is invented. A provider we cannot
 * probe comes out as `status: "unknown"` carrying the reason WHY, and the UI
 * shows that reason rather than a colour that implies knowledge we do not
 * have.
 */

export interface ProviderRow {
  key: string;
  displayName: string;
  vendor: string;
  description: string;
  capabilities: string[];
  status: ProviderStatus;
  /** Present only when status is "unknown" and there is no probe. */
  unknownReason: string | null;
  /** What a green actually proves for this provider, when it is qualified. */
  probeMeaning: string | null;
  keyEnvVar: string | null;
  keyPresent: boolean;
  /** null when the provider needs no credential. */
  keyStatus: "present" | "missing" | "not-required" | "per-user";
  baseUrl: string | null;
  costTier: string;
  planState: string;
  planExpiresAt: string | null;
  planNote: string | null;
  enabled: boolean;
  concurrencyCap: number | null;
  concurrencySource: "operator" | "catalog" | "uncapped";
  latencyMs: number | null;
  lastCheckedAt: string | null;
  probeError: string | null;
  probeDetail: Record<string, unknown> | null;
  deprecated: boolean;
  deprecationNote: string | null;
  hostProcess: string | null;
  usedBy: string[];
  docsUrl: string | null;
  /** Reference-only provider (openai/google_tts/inworld/elevenlabs_official). */
  isNote: boolean;
  /** Worst expiry clock across this provider (Phase C / C1). */
  expiryStatus: ExpiryStatus;
  /** Every clock this provider carries, with each clock's own status. */
  expiries: Array<{
    kind: string;
    label: string;
    expiresAt: string | null;
    status: ExpiryStatus;
    source: string;
    note: string | null;
  }>;
  /** Calls served in the rollup window. null = no usage data collected. */
  callsLast24h: number | null;
  fallbacksLast24h: number | null;
  errorsLast24h: number | null;
}

export interface ChainView {
  capability: RoutedCapability;
  entries: Array<
    ResolvedChainEntry & { displayName: string; note: string | null }
  >;
  /** null when every hop is blocked — a capability with nowhere to go. */
  primary: string | null;
}

export interface ConsumerPriorityRow {
  consumer: string;
  priority: number;
  isOverride: boolean;
}

export interface RegistryView {
  providers: ProviderRow[];
  chains: ChainView[];
  consumerPriorities: ConsumerPriorityRow[];
}

function keyStatusFor(
  definition: ProviderDefinition,
  present: boolean,
): ProviderRow["keyStatus"] {
  if (!definition.keyEnvVar) {
    // No env var. Either it genuinely needs no credential, or the credential
    // is per-user and encrypted — the probe reason spells out which.
    return definition.probeUnavailableReason?.includes("per-VA") ||
      definition.probeUnavailableReason?.includes("Per-VA")
      ? "per-user"
      : "not-required";
  }
  return present ? "present" : "missing";
}

export function buildRegistryView(
  snapshot: RegistrySnapshot,
  rollup: UsageRollup[],
  env: NodeJS.ProcessEnv = process.env,
): RegistryView {
  const rollupByKey = new Map(rollup.map((r) => [r.providerKey, r]));
  const hasUsageData = rollup.length > 0;
  const allExpiries: ProviderExpiry[] = snapshot.expiries ?? [];

  const providers: ProviderRow[] = snapshot.providers
    .slice()
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
    .map((definition) => {
      const state = snapshot.states[definition.key];
      const health = snapshot.health[definition.key];
      const present = keyPresent(definition, env);
      const status = effectiveStatus({
        definition,
        state,
        health,
        keyPresent: present,
        expiries: allExpiries,
      });
      const myExpiries = allExpiries.filter(
        (e) => e.providerKey === definition.key,
      );
      const operatorCap = state?.maxConcurrent ?? null;
      const cap = operatorCap ?? definition.defaultMaxConcurrent;
      const usage = rollupByKey.get(definition.key);

      return {
        key: definition.key,
        displayName: definition.displayName,
        vendor: definition.vendor,
        description: definition.description,
        capabilities: definition.capabilities,
        status,
        unknownReason:
          status === "unknown"
            ? (definition.probeUnavailableReason ??
              (health ? null : "never probed"))
            : null,
        probeMeaning: definition.probe?.meaning ?? null,
        keyEnvVar: definition.keyEnvVar,
        keyPresent: present,
        keyStatus: keyStatusFor(definition, present),
        baseUrl: baseUrlFor(definition, env),
        costTier: state?.costTier ?? definition.costTier,
        planState: state?.planState ?? definition.planState,
        planExpiresAt: state?.planExpiresAt ?? definition.planExpiresAt ?? null,
        planNote: definition.planNote ?? null,
        enabled: state?.enabled ?? true,
        concurrencyCap: cap,
        concurrencySource:
          operatorCap != null
            ? ("operator" as const)
            : cap != null
              ? ("catalog" as const)
              : ("uncapped" as const),
        latencyMs: health?.latencyMs ?? null,
        lastCheckedAt: health?.checkedAt ?? null,
        probeError: health?.error ?? null,
        probeDetail: health?.detail ?? null,
        deprecated: definition.deprecated ?? false,
        deprecationNote: definition.deprecationNote ?? null,
        hostProcess: definition.hostProcess ?? null,
        usedBy: definition.usedBy,
        docsUrl: definition.docsUrl ?? null,
        isNote: definition.role === "note",
        expiryStatus: providerExpiryStatus(allExpiries, definition.key),
        expiries: myExpiries.map((e) => ({
          kind: e.kind,
          label: e.label,
          expiresAt: e.expiresAt,
          status: expiryClockStatus(e),
          source: e.source,
          note: e.note,
        })),
        // Distinguish "zero calls" from "we collect no data yet". Showing 0
        // when nothing is instrumented would be its own quiet lie.
        callsLast24h: hasUsageData ? (usage?.total ?? 0) : null,
        fallbacksLast24h: hasUsageData ? (usage?.fallbacks ?? 0) : null,
        errorsLast24h: hasUsageData ? (usage?.errors ?? 0) : null,
      };
    });

  const nameByKey = new Map(
    snapshot.providers.map((p) => [p.key, p.displayName]),
  );

  const chains: ChainView[] = ROUTED_CAPABILITIES.map((capability) => {
    const resolved = resolveChain(snapshot, capability, null, {
      keyPresent: (k) => {
        const d = snapshot.providers.find((p) => p.key === k);
        return d ? keyPresent(d, env) : false;
      },
    });
    const entries = resolved.map((e) => ({
      ...e,
      displayName: nameByKey.get(e.providerKey) ?? e.providerKey,
      note:
        snapshot.links.find(
          (l) =>
            l.capability === capability &&
            l.providerKey === e.providerKey &&
            l.consumer === null,
        )?.note ?? null,
    }));
    return {
      capability,
      entries,
      primary: entries.find((e) => e.eligible)?.providerKey ?? null,
    };
  }).filter((c) => c.entries.length > 0);

  const consumerPriorities: ConsumerPriorityRow[] = KNOWN_CONSUMERS.map(
    (consumer) => ({
      consumer,
      priority: effectivePriority(snapshot.priorities, consumer, null),
      isOverride: snapshot.priorities.some(
        (p) => p.consumer === consumer && p.capability === null,
      ),
    }),
  ).sort((a, b) => b.priority - a.priority);

  return { providers, chains, consumerPriorities };
}
