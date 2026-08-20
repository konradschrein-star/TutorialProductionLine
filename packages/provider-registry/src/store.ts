/**
 * Registry persistence.
 *
 * The catalog (catalog.ts) is code truth; these tables are the operator
 * overlay. `syncCatalog()` reconciles them: new catalog entries are inserted,
 * identity/probe fields are refreshed, and operator switches (enabled,
 * max_concurrent, notes) are LEFT ALONE — the operator's choices survive
 * every deploy.
 *
 * Connection: pass a Drizzle client, or let it lazily build one from
 * DATABASE_URL. Both hub-web (route handlers) and worker-orchestrator
 * (gateway instrumentation) already have that env var.
 */

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import {
  providers as providersTable,
  providerCapabilityLinks,
  providerConsumerPriorities,
  providerHealthChecks,
  providerUsageEvents,
  providerExpiries,
  capabilityPolicies,
  computeNodes,
  computeNodeHeartbeats,
} from "@repo/db/schema";
import {
  BUILT_IN_PROVIDERS,
  DEFAULT_CHAINS,
  DEFAULT_CAPABILITY_POLICIES,
  PROVIDER_EXPIRIES,
} from "./catalog.js";
import type {
  CapabilityPolicy,
  ChainLink,
  ConsumerPriority,
  ExpiryKind,
  ExpirySource,
  HealthResult,
  ProviderExpiry,
  ProviderState,
  ProviderStatus,
  ProviderUseEvent,
  RegistrySnapshot,
  RoutedCapability,
} from "./types.js";
import { ROUTED_CAPABILITIES } from "./types.js";

// ── Connection ──────────────────────────────────────────────────────────────

let injected: DrizzleClient | null = null;
let lazy: DrizzleClient | null = null;

/** Inject an existing client (hub-web does this so it shares the pool). */
export function setRegistryDb(client: DrizzleClient): void {
  injected = client;
}

export function registryDb(): DrizzleClient {
  if (injected) return injected;
  if (lazy) return lazy;
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "provider-registry: DATABASE_URL is not set and no client was injected",
    );
  }
  lazy = createDrizzleClient(url);
  return lazy;
}

// ── Catalog sync ────────────────────────────────────────────────────────────

/**
 * Reconcile the catalog into the DB. Idempotent. Safe to run on every boot.
 *
 * Refreshed from code: display_name, vendor, description, capabilities,
 * base_url, docs_url, env var names, cost_tier, plan_state/expiry/note,
 * deprecated, sort_order.
 * Preserved from the operator: enabled, max_concurrent, notes.
 */
export async function syncCatalog(db: DrizzleClient = registryDb()): Promise<{
  providers: number;
  links: number;
}> {
  for (const p of BUILT_IN_PROVIDERS) {
    await db
      .insert(providersTable)
      .values({
        key: p.key,
        display_name: p.displayName,
        vendor: p.vendor,
        description: p.description,
        capabilities: p.capabilities,
        base_url: p.defaultBaseUrl ?? null,
        docs_url: p.docsUrl ?? null,
        key_env_var: p.keyEnvVar,
        url_env_var: p.urlEnvVar ?? null,
        cost_tier: p.costTier,
        plan_state: p.planState,
        plan_expires_at: p.planExpiresAt ? new Date(p.planExpiresAt) : null,
        plan_note: p.planNote ?? null,
        deprecated: p.deprecated ?? false,
        sort_order: p.sortOrder ?? null,
      })
      .onConflictDoUpdate({
        target: providersTable.key,
        set: {
          display_name: p.displayName,
          vendor: p.vendor,
          description: p.description,
          capabilities: p.capabilities,
          base_url: p.defaultBaseUrl ?? null,
          docs_url: p.docsUrl ?? null,
          key_env_var: p.keyEnvVar,
          url_env_var: p.urlEnvVar ?? null,
          cost_tier: p.costTier,
          plan_state: p.planState,
          plan_expires_at: p.planExpiresAt ? new Date(p.planExpiresAt) : null,
          plan_note: p.planNote ?? null,
          deprecated: p.deprecated ?? false,
          sort_order: p.sortOrder ?? null,
          updated_at: new Date(),
        },
      });
  }

  // Chains: insert the default shape once, never overwrite operator edits.
  // (A link the operator switched off must stay off across deploys.)
  let linksInserted = 0;
  for (const c of DEFAULT_CHAINS) {
    const existing = await db
      .select({ id: providerCapabilityLinks.id })
      .from(providerCapabilityLinks)
      .where(
        and(
          eq(providerCapabilityLinks.capability, c.capability),
          eq(providerCapabilityLinks.provider_key, c.providerKey),
          sql`${providerCapabilityLinks.consumer} IS NULL`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(providerCapabilityLinks).values({
      capability: c.capability,
      provider_key: c.providerKey,
      position: c.position,
      enabled: c.enabled,
      consumer: null,
      note: c.note ?? null,
    });
    linksInserted++;
  }

  // Expiry clocks (Phase C): upsert the seeds idempotently on
  // (provider_key, kind, label). Refresh code-owned fields; leave a null
  // seed date alone if an operator has since supplied one.
  for (const e of PROVIDER_EXPIRIES) {
    await db
      .insert(providerExpiries)
      .values({
        provider_key: e.providerKey,
        kind: e.kind,
        label: e.label,
        expires_at: e.expiresAt ? new Date(e.expiresAt) : null,
        source: e.source,
        warn_days_before: e.warnDaysBefore,
        last_verified_at: e.lastVerifiedAt ? new Date(e.lastVerifiedAt) : null,
        evidence: e.evidence,
        note: e.note,
      })
      .onConflictDoUpdate({
        target: [
          providerExpiries.provider_key,
          providerExpiries.kind,
          providerExpiries.label,
        ],
        set: {
          warn_days_before: e.warnDaysBefore,
          note: e.note,
          updated_at: new Date(),
        },
      });
  }

  // Fallback policies (Phase B2): seed one permissive global row per capability
  // if none exists. Never overwrite an operator's strict toggle.
  for (const p of DEFAULT_CAPABILITY_POLICIES) {
    const existing = await db
      .select({ id: capabilityPolicies.id })
      .from(capabilityPolicies)
      .where(
        and(
          eq(capabilityPolicies.capability, p.capability),
          sql`${capabilityPolicies.consumer} IS NULL`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(capabilityPolicies).values({
      capability: p.capability,
      consumer: null,
      strict: p.strict,
      max_fallback_depth: p.maxFallbackDepth,
      require_ack: p.requireAck,
    });
  }

  return { providers: BUILT_IN_PROVIDERS.length, links: linksInserted };
}

// ── Snapshot ────────────────────────────────────────────────────────────────

function toRoutedCapability(value: string): RoutedCapability | null {
  return (ROUTED_CAPABILITIES as readonly string[]).includes(value)
    ? (value as RoutedCapability)
    : null;
}

/**
 * Load everything the UI and gateways need in one round trip.
 *
 * `health` carries only the LATEST probe per provider. Providers that have
 * never been probed are simply absent — callers must render that as
 * "unknown / not probed", never as green.
 */
export async function loadSnapshot(
  db: DrizzleClient = registryDb(),
): Promise<RegistrySnapshot> {
  const [rows, linkRows, priorityRows, healthRows, expiryRows, policyRows] =
    await Promise.all([
      db.select().from(providersTable),
      db.select().from(providerCapabilityLinks),
      db.select().from(providerConsumerPriorities),
      // A4 (staleness): the LATEST probe per provider REGARDLESS of age. The
      // old 24h filter silently reverted every provider to "unknown" after a
      // day with no probe run; now the UI gets the real last result plus its
      // checkedAt and can render "last checked 3 days ago" honestly.
      db
        .selectDistinctOn([providerHealthChecks.provider_key])
        .from(providerHealthChecks)
        .orderBy(
          asc(providerHealthChecks.provider_key),
          desc(providerHealthChecks.checked_at),
        ),
      db.select().from(providerExpiries),
      db.select().from(capabilityPolicies),
    ]);

  const states: Record<string, ProviderState> = {};
  for (const r of rows) {
    states[r.key] = {
      key: r.key,
      enabled: r.enabled,
      maxConcurrent: r.max_concurrent,
      planState: r.plan_state as ProviderState["planState"],
      planExpiresAt: r.plan_expires_at ? r.plan_expires_at.toISOString() : null,
      costTier: r.cost_tier as ProviderState["costTier"],
      notes: r.notes,
    };
  }

  const links: ChainLink[] = linkRows.flatMap((r) => {
    const cap = toRoutedCapability(r.capability);
    if (!cap) return [];
    return [
      {
        capability: cap,
        providerKey: r.provider_key,
        position: r.position,
        enabled: r.enabled,
        consumer: r.consumer,
        note: r.note,
      },
    ];
  });

  const priorities: ConsumerPriority[] = priorityRows.flatMap((r) => {
    const cap = r.capability ? toRoutedCapability(r.capability) : null;
    if (r.capability && !cap) return [];
    return [
      {
        consumer: r.consumer,
        capability: cap,
        priority: r.priority,
        maxConcurrent: r.max_concurrent,
      },
    ];
  });

  // Rows come back newest-first, so the first sighting of a key is the latest.
  const health: Record<string, HealthResult> = {};
  for (const r of healthRows) {
    if (health[r.provider_key]) continue;
    health[r.provider_key] = {
      providerKey: r.provider_key,
      status: r.status as ProviderStatus,
      latencyMs: r.latency_ms,
      httpStatus: r.http_status,
      detail: r.detail ?? null,
      error: r.error,
      checkedAt: r.checked_at.toISOString(),
    };
  }

  const expiries: ProviderExpiry[] = expiryRows.map((r) => ({
    providerKey: r.provider_key,
    kind: r.kind as ExpiryKind,
    label: r.label,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    source: r.source as ExpirySource,
    warnDaysBefore: r.warn_days_before,
    lastVerifiedAt: r.last_verified_at
      ? r.last_verified_at.toISOString()
      : null,
    evidence: r.evidence ?? null,
    note: r.note,
  }));

  const policies: CapabilityPolicy[] = policyRows.flatMap((r) => {
    const cap = toRoutedCapability(r.capability);
    if (!cap) return [];
    return [
      {
        capability: cap,
        consumer: r.consumer,
        strict: r.strict,
        maxFallbackDepth: r.max_fallback_depth,
        requireAck: r.require_ack,
      },
    ];
  });

  return {
    providers: BUILT_IN_PROVIDERS,
    states,
    links,
    priorities,
    health,
    expiries,
    policies,
  };
}

// ── Health persistence ──────────────────────────────────────────────────────

export async function saveHealthResults(
  results: HealthResult[],
  db: DrizzleClient = registryDb(),
): Promise<void> {
  if (results.length === 0) return;
  await db.insert(providerHealthChecks).values(
    results.map((r) => ({
      provider_key: r.providerKey,
      status: r.status,
      latency_ms: r.latencyMs,
      http_status: r.httpStatus,
      detail: r.detail,
      error: r.error,
      checked_at: new Date(r.checkedAt),
    })),
  );
}

/** Probe history for one provider, newest first. */
export async function healthHistory(
  providerKey: string,
  hours = 24,
  db: DrizzleClient = registryDb(),
): Promise<HealthResult[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select()
    .from(providerHealthChecks)
    .where(
      and(
        eq(providerHealthChecks.provider_key, providerKey),
        gte(providerHealthChecks.checked_at, since),
      ),
    )
    .orderBy(desc(providerHealthChecks.checked_at))
    .limit(200);
  return rows.map((r) => ({
    providerKey: r.provider_key,
    status: r.status as ProviderStatus,
    latencyMs: r.latency_ms,
    httpStatus: r.http_status,
    detail: r.detail ?? null,
    error: r.error,
    checkedAt: r.checked_at.toISOString(),
  }));
}

// ── Usage events ────────────────────────────────────────────────────────────

export async function insertUsageEvents(
  events: ProviderUseEvent[],
  db: DrizzleClient = registryDb(),
): Promise<void> {
  if (events.length === 0) return;
  await db.insert(providerUsageEvents).values(
    events.map((e) => ({
      capability: e.capability,
      consumer: e.consumer,
      requested_provider: e.requestedProvider ?? null,
      served_provider: e.servedProvider,
      is_fallback: e.isFallback,
      fallback_depth: e.fallbackDepth,
      outcome: e.outcome,
      latency_ms: e.latencyMs ?? null,
      job_id: e.jobId ?? null,
      context: e.context ?? null,
      error: e.error ?? null,
      attempted_chain: e.attemptedChain ?? null,
    })),
  );
}

export interface UsageEventRow extends ProviderUseEvent {
  id: string;
  createdAt: string;
}

/** Recent fallback events — the loud panel on the System Health page. */
export async function recentFallbacks(
  limit = 25,
  db: DrizzleClient = registryDb(),
): Promise<UsageEventRow[]> {
  const rows = await db
    .select()
    .from(providerUsageEvents)
    .where(eq(providerUsageEvents.is_fallback, true))
    .orderBy(desc(providerUsageEvents.created_at))
    .limit(limit);
  return rows.map(mapUsageRow);
}

export async function recentUsage(
  limit = 50,
  db: DrizzleClient = registryDb(),
): Promise<UsageEventRow[]> {
  const rows = await db
    .select()
    .from(providerUsageEvents)
    .orderBy(desc(providerUsageEvents.created_at))
    .limit(limit);
  return rows.map(mapUsageRow);
}

export interface UsageRollup {
  providerKey: string;
  total: number;
  fallbacks: number;
  errors: number;
}

/** Per-provider call counts over a window — "is it even used?". */
export async function usageRollup(
  hours = 24,
  db: DrizzleClient = registryDb(),
): Promise<UsageRollup[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select({
      providerKey: providerUsageEvents.served_provider,
      total: sql<number>`count(*)::int`,
      fallbacks: sql<number>`count(*) filter (where ${providerUsageEvents.is_fallback})::int`,
      errors: sql<number>`count(*) filter (where ${providerUsageEvents.outcome} = 'error')::int`,
    })
    .from(providerUsageEvents)
    .where(gte(providerUsageEvents.created_at, since))
    .groupBy(providerUsageEvents.served_provider);
  return rows;
}

export interface CapabilityOutcome {
  capability: string;
  attempts: number;
  successes: number;
  errors: number;
  fallbacks: number;
  /** null when there were no attempts at all — do NOT render that as 100%. */
  successRate: number | null;
  /**
   * A capability that attempted real work and succeeded at NOTHING. This is
   * the "57 thumbnails, 0 succeeded" signal. A provider ping stays green
   * through this; only outcomes catch it, so it outranks provider status on
   * the page.
   */
  sustainedFailure: boolean;
}

/** Minimum attempts before a 0% success rate counts as a sustained failure. */
export const SUSTAINED_FAILURE_MIN_ATTEMPTS = 5;

/**
 * Success/failure per capability over a window.
 *
 * Provider health answers "does it answer the phone". This answers "did the
 * work actually come out", which is the question that went unasked while
 * every thumbnail failed for weeks.
 */
export async function capabilityOutcomes(
  hours = 24,
  db: DrizzleClient = registryDb(),
): Promise<CapabilityOutcome[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await db
    .select({
      capability: providerUsageEvents.capability,
      attempts: sql<number>`count(*)::int`,
      successes: sql<number>`count(*) filter (where ${providerUsageEvents.outcome} = 'success')::int`,
      errors: sql<number>`count(*) filter (where ${providerUsageEvents.outcome} = 'error')::int`,
      fallbacks: sql<number>`count(*) filter (where ${providerUsageEvents.is_fallback})::int`,
    })
    .from(providerUsageEvents)
    .where(gte(providerUsageEvents.created_at, since))
    .groupBy(providerUsageEvents.capability);

  return rows.map((r) => ({
    capability: r.capability,
    attempts: r.attempts,
    successes: r.successes,
    errors: r.errors,
    fallbacks: r.fallbacks,
    successRate: r.attempts > 0 ? r.successes / r.attempts : null,
    sustainedFailure:
      r.attempts >= SUSTAINED_FAILURE_MIN_ATTEMPTS && r.successes === 0,
  }));
}

function mapUsageRow(
  r: typeof providerUsageEvents.$inferSelect,
): UsageEventRow {
  return {
    id: r.id,
    capability: r.capability as ProviderUseEvent["capability"],
    consumer: r.consumer,
    requestedProvider: r.requested_provider,
    servedProvider: r.served_provider,
    isFallback: r.is_fallback,
    fallbackDepth: r.fallback_depth,
    outcome: r.outcome as ProviderUseEvent["outcome"],
    latencyMs: r.latency_ms,
    jobId: r.job_id,
    context: r.context,
    error: r.error,
    attemptedChain: r.attempted_chain,
    createdAt: r.created_at.toISOString(),
  };
}

// ── Operator mutations ──────────────────────────────────────────────────────

export async function setProviderEnabled(
  key: string,
  enabled: boolean,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .update(providersTable)
    .set({ enabled, updated_at: new Date() })
    .where(eq(providersTable.key, key));
}

export async function setProviderConcurrency(
  key: string,
  maxConcurrent: number | null,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .update(providersTable)
    .set({ max_concurrent: maxConcurrent, updated_at: new Date() })
    .where(eq(providersTable.key, key));
}

export async function setLinkEnabled(
  capability: string,
  providerKey: string,
  consumer: string | null,
  enabled: boolean,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .update(providerCapabilityLinks)
    .set({ enabled, updated_at: new Date() })
    .where(
      and(
        eq(providerCapabilityLinks.capability, capability),
        eq(providerCapabilityLinks.provider_key, providerKey),
        consumer === null
          ? sql`${providerCapabilityLinks.consumer} IS NULL`
          : eq(providerCapabilityLinks.consumer, consumer),
      ),
    );
}

export async function setConsumerPriority(
  consumer: string,
  capability: string | null,
  priority: number,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  const existing = await db
    .select({ id: providerConsumerPriorities.id })
    .from(providerConsumerPriorities)
    .where(
      and(
        eq(providerConsumerPriorities.consumer, consumer),
        capability === null
          ? sql`${providerConsumerPriorities.capability} IS NULL`
          : eq(providerConsumerPriorities.capability, capability),
      ),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    await db
      .update(providerConsumerPriorities)
      .set({ priority, updated_at: new Date() })
      .where(eq(providerConsumerPriorities.id, existing[0].id));
    return;
  }
  await db
    .insert(providerConsumerPriorities)
    .values({ consumer, capability, priority });
}

// ── Chain reorder (Phase D — drag-reorderable fallback chains) ───────────────

/** Move a chain hop to a new position. UI action `link-position`. */
export async function setLinkPosition(
  capability: string,
  providerKey: string,
  consumer: string | null,
  position: number,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .update(providerCapabilityLinks)
    .set({ position, updated_at: new Date() })
    .where(
      and(
        eq(providerCapabilityLinks.capability, capability),
        eq(providerCapabilityLinks.provider_key, providerKey),
        consumer === null
          ? sql`${providerCapabilityLinks.consumer} IS NULL`
          : eq(providerCapabilityLinks.consumer, consumer),
      ),
    );
}

// ── Capability policies (Phase B2) ───────────────────────────────────────────

/** Set (upsert) the fallback policy for a capability / consumer. */
export async function setCapabilityPolicy(
  capability: string,
  consumer: string | null,
  patch: {
    strict?: boolean;
    maxFallbackDepth?: number | null;
    requireAck?: boolean;
  },
  db: DrizzleClient = registryDb(),
): Promise<void> {
  const existing = await db
    .select({ id: capabilityPolicies.id })
    .from(capabilityPolicies)
    .where(
      and(
        eq(capabilityPolicies.capability, capability),
        consumer === null
          ? sql`${capabilityPolicies.consumer} IS NULL`
          : eq(capabilityPolicies.consumer, consumer),
      ),
    )
    .limit(1);

  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.strict !== undefined) set["strict"] = patch.strict;
  if (patch.maxFallbackDepth !== undefined)
    set["max_fallback_depth"] = patch.maxFallbackDepth;
  if (patch.requireAck !== undefined) set["require_ack"] = patch.requireAck;

  if (existing.length > 0 && existing[0]) {
    await db
      .update(capabilityPolicies)
      .set(set)
      .where(eq(capabilityPolicies.id, existing[0].id));
    return;
  }
  await db.insert(capabilityPolicies).values({
    capability,
    consumer,
    strict: patch.strict ?? false,
    max_fallback_depth: patch.maxFallbackDepth ?? null,
    require_ack: patch.requireAck ?? false,
  });
}

// ── Expiry clocks (Phase C) ──────────────────────────────────────────────────

/** Upsert one expiry clock (operator edit or a probe-derived date). */
export async function upsertProviderExpiry(
  e: ProviderExpiry,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .insert(providerExpiries)
    .values({
      provider_key: e.providerKey,
      kind: e.kind,
      label: e.label,
      expires_at: e.expiresAt ? new Date(e.expiresAt) : null,
      source: e.source,
      warn_days_before: e.warnDaysBefore,
      last_verified_at: e.lastVerifiedAt ? new Date(e.lastVerifiedAt) : null,
      evidence: e.evidence,
      note: e.note,
    })
    .onConflictDoUpdate({
      target: [
        providerExpiries.provider_key,
        providerExpiries.kind,
        providerExpiries.label,
      ],
      set: {
        expires_at: e.expiresAt ? new Date(e.expiresAt) : null,
        source: e.source,
        warn_days_before: e.warnDaysBefore,
        last_verified_at: e.lastVerifiedAt ? new Date(e.lastVerifiedAt) : null,
        evidence: e.evidence,
        note: e.note,
        updated_at: new Date(),
      },
    });
}

// ── Compute-node registry (Phase F1) ─────────────────────────────────────────

export type ComputeNodeDerivedStatus =
  | "online"
  | "stale"
  | "offline"
  | "disabled"
  | "draining";

export interface ComputeNodeView {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  capabilities: string[];
  capacity: Record<string, unknown> | null;
  budget: Record<string, unknown> | null;
  lastHeartbeatAt: string | null;
  agentVersion: string | null;
  os: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  gpuModel: string | null;
  vramGb: number | null;
  drainRequestedAt: string | null;
  status: ComputeNodeDerivedStatus;
  note: string | null;
}

/** Status is DERIVED, never stored (plan §F1). */
export function deriveNodeStatus(
  row: {
    enabled: boolean;
    drain_requested_at: Date | null;
    last_heartbeat_at: Date | null;
  },
  now: Date = new Date(),
): ComputeNodeDerivedStatus {
  if (!row.enabled) return "disabled";
  if (row.drain_requested_at) return "draining";
  if (!row.last_heartbeat_at) return "offline";
  const age = now.getTime() - row.last_heartbeat_at.getTime();
  if (age < 90_000) return "online";
  if (age < 600_000) return "stale";
  return "offline";
}

export async function listComputeNodes(
  db: DrizzleClient = registryDb(),
): Promise<ComputeNodeView[]> {
  const rows = await db
    .select()
    .from(computeNodes)
    .orderBy(asc(computeNodes.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    enabled: r.enabled,
    capabilities: r.capabilities,
    capacity: r.capacity ?? null,
    budget: r.budget ?? null,
    lastHeartbeatAt: r.last_heartbeat_at
      ? r.last_heartbeat_at.toISOString()
      : null,
    agentVersion: r.agent_version,
    os: r.os,
    cpuModel: r.cpu_model,
    cpuCores: r.cpu_cores,
    gpuModel: r.gpu_model,
    vramGb: r.vram_gb,
    drainRequestedAt: r.drain_requested_at
      ? r.drain_requested_at.toISOString()
      : null,
    status: deriveNodeStatus(r),
    note: r.note,
  }));
}

/** Konrad's one control: flip a node on/off. Off ⇒ agent drains. */
export async function setComputeNodeEnabled(
  id: string,
  enabled: boolean,
  db: DrizzleClient = registryDb(),
): Promise<void> {
  await db
    .update(computeNodes)
    .set({
      enabled,
      // Turning it off requests a graceful drain; turning it on clears it.
      drain_requested_at: enabled ? null : new Date(),
      updated_at: new Date(),
    })
    .where(eq(computeNodes.id, id));
}

/** Node agent heartbeat: refresh liveness + advertised specs, log a sample. */
export async function recordNodeHeartbeat(
  id: string,
  sample: {
    cpuPct?: number | null;
    memGb?: number | null;
    gpuPct?: number | null;
    queueDepth?: number | null;
    agentVersion?: string | null;
    metrics?: Record<string, unknown> | null;
  },
  db: DrizzleClient = registryDb(),
): Promise<void> {
  const now = new Date();
  await db
    .update(computeNodes)
    .set({
      last_heartbeat_at: now,
      ...(sample.agentVersion ? { agent_version: sample.agentVersion } : {}),
      updated_at: now,
    })
    .where(eq(computeNodes.id, id));
  await db.insert(computeNodeHeartbeats).values({
    node_id: id,
    cpu_pct: sample.cpuPct ?? null,
    mem_gb: sample.memGb ?? null,
    gpu_pct: sample.gpuPct ?? null,
    queue_depth: sample.queueDepth ?? null,
    metrics: sample.metrics ?? null,
    reported_at: now,
  });
}
