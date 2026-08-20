/**
 * Provider registry tables (migration 0038).
 *
 * These tables are an OPERATOR OVERLAY on the code-defined catalog in
 * @repo/provider-registry. The catalog owns identity, capabilities, env var
 * names and probe definitions; these rows own the switches: enabled,
 * concurrency cap, plan state, chain order, per-consumer priority.
 *
 * NO CREDENTIALS ARE STORED HERE. `key_env_var` holds only the NAME of the
 * environment variable that carries a key; presence is computed at runtime.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/** One row per external service we can call. */
export const providers = pgTable(
  "providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable slug matching ProviderDefinition.key (e.g. "vup", "fastgen"). */
    key: text("key").notNull().unique(),
    display_name: text("display_name").notNull(),
    vendor: text("vendor"),
    description: text("description"),
    /** image | video | tts | llm | music | footage | storage | other */
    capabilities: text("capabilities").array().notNull().default([]),
    base_url: text("base_url"),
    docs_url: text("docs_url"),
    /** NAME of the env var holding the credential. Never the credential. */
    key_env_var: text("key_env_var"),
    url_env_var: text("url_env_var"),
    /** free | cheap | standard | premium | unknown */
    cost_tier: text("cost_tier").notNull().default("unknown"),
    /** active | expired | trial | self_hosted | none | unknown */
    plan_state: text("plan_state").notNull().default("unknown"),
    plan_expires_at: timestamp("plan_expires_at", { withTimezone: true }),
    plan_note: text("plan_note"),
    /** Operator master switch. Disabled providers are never dispatched to. */
    enabled: boolean("enabled").notNull().default(true),
    /** Operator override of the catalog default. NULL = use catalog value. */
    max_concurrent: integer("max_concurrent"),
    /** Still referenced by code but dead/superseded. */
    deprecated: boolean("deprecated").notNull().default(false),
    notes: text("notes"),
    sort_order: integer("sort_order"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    enabledIdx: index("idx_providers_enabled").on(t.enabled),
    planIdx: index("idx_providers_plan_state").on(t.plan_state),
  }),
);

/**
 * Ordered capability chains. position 1 = primary, everything after is a
 * fallback. `enabled=false` means that hop is switched OFF and will never
 * be used — fallback is opt-in, not automatic.
 *
 * consumer NULL = the global chain. A non-null consumer defines an override
 * chain that fully replaces the global one for that consumer.
 */
export const providerCapabilityLinks = pgTable(
  "provider_capability_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capability: text("capability").notNull(),
    provider_key: text("provider_key").notNull(),
    position: integer("position").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    consumer: text("consumer"),
    note: text("note"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    capabilityIdx: index("idx_provider_links_capability").on(
      t.capability,
      t.position,
    ),
    // Uniqueness is enforced by two PARTIAL unique indexes in migration 0038
    // (uq_provider_links_global / uq_provider_links_consumer) which Drizzle
    // cannot express; declared here as a plain index so queries still plan well.
    lookupIdx: index("idx_provider_links_lookup").on(
      t.capability,
      t.consumer,
      t.provider_key,
    ),
  }),
);

/**
 * Per-consumer priority + optional sub-cap. Higher priority = served first
 * out of the shared global pool. capability NULL = applies to all.
 */
export const providerConsumerPriorities = pgTable(
  "provider_consumer_priorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consumer: text("consumer").notNull(),
    capability: text("capability"),
    priority: integer("priority").notNull(),
    max_concurrent: integer("max_concurrent"),
    note: text("note"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Partial unique indexes live in migration 0038
    // (uq_provider_consumer_priority_all / _cap).
    consumerIdx: index("idx_provider_consumer_priority_lookup").on(
      t.consumer,
      t.capability,
    ),
  }),
);

/** Probe results over time — the health history behind the status badge. */
export const providerHealthChecks = pgTable(
  "provider_health_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider_key: text("provider_key").notNull(),
    /** up | degraded | down | expired | disabled | no_key | unknown */
    status: text("status").notNull(),
    latency_ms: integer("latency_ms"),
    http_status: integer("http_status"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    error: text("error"),
    checked_at: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerTimeIdx: index("idx_provider_health_provider_time").on(
      t.provider_key,
      t.checked_at,
    ),
  }),
);

/**
 * Every gateway call, recorded with WHO ACTUALLY SERVED IT.
 *
 * `is_fallback = true` is the thing the operator needs to see: the request
 * wanted `requested_provider` and got `served_provider` instead. This is the
 * Nano-Banana-2 → Seedream 4.5 detector.
 */
export const providerUsageEvents = pgTable(
  "provider_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capability: text("capability").notNull(),
    /** Content format or subsystem that asked. */
    consumer: text("consumer").notNull(),
    requested_provider: text("requested_provider"),
    served_provider: text("served_provider").notNull(),
    is_fallback: boolean("is_fallback").notNull().default(false),
    /** 0 = primary served it, 1 = first fallback, … */
    fallback_depth: integer("fallback_depth").notNull().default(0),
    /** success | error | skipped */
    outcome: text("outcome").notNull(),
    latency_ms: integer("latency_ms"),
    job_id: text("job_id"),
    context: text("context"),
    error: text("error"),
    /** Ordered providers attempted, for the "why" of a fallback. */
    attempted_chain: text("attempted_chain").array(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdIdx: index("idx_provider_usage_created").on(t.created_at),
    fallbackIdx: index("idx_provider_usage_fallback").on(
      t.is_fallback,
      t.created_at,
    ),
    providerIdx: index("idx_provider_usage_served").on(
      t.served_provider,
      t.created_at,
    ),
  }),
);

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type ProviderCapabilityLink =
  typeof providerCapabilityLinks.$inferSelect;
export type NewProviderCapabilityLink =
  typeof providerCapabilityLinks.$inferInsert;
export type ProviderConsumerPriority =
  typeof providerConsumerPriorities.$inferSelect;
export type NewProviderConsumerPriority =
  typeof providerConsumerPriorities.$inferInsert;
export type ProviderHealthCheck = typeof providerHealthChecks.$inferSelect;
export type NewProviderHealthCheck = typeof providerHealthChecks.$inferInsert;
export type ProviderUsageEvent = typeof providerUsageEvents.$inferSelect;
export type NewProviderUsageEvent = typeof providerUsageEvents.$inferInsert;
