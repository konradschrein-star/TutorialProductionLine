/**
 * Provider call-site index + observed-consumer rollup (migration 0045) — §2.4.
 *
 * The "used where" view Konrad asked for needs to be TRUE, and the hand-typed
 * `usedBy` prose in the catalog has already drifted four times. Two sources of
 * truth, because each catches what the other misses:
 *
 *   provider_call_sites  STATIC — where a provider client is imported in the
 *                        codebase, emitted by a build-time AST indexer. Catches
 *                        code that has never run.
 *   provider_consumers   OBSERVED — the (provider, consumer, capability) matrix
 *                        rolled up from provider_usage_events. The only
 *                        provably-current source, and the surface the "Reassign
 *                        consumers" control acts on.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/** Static import call sites, refreshed by scripts/index-provider-call-sites.ts. */
export const providerCallSites = pgTable(
  "provider_call_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider_key: text("provider_key").notNull(),
    file: text("file").notNull(),
    line: integer("line").notNull(),
    symbol: text("symbol"),
    /** import | gateway-exempt | dynamic — how the reference was found. */
    kind: text("kind").notNull().default("import"),
    /** The indexer run that produced this row (so stale rows can be pruned). */
    indexed_at: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerIdx: index("idx_provider_call_sites_provider").on(t.provider_key),
  }),
);

/**
 * Observed consumer × provider × capability rollup from usage events.
 * Refreshed by the prober / a rollup job. `last_seen_at` lets the UI show
 * "not seen in 30 days" instead of pretending a stale mapping is live.
 */
export const providerConsumers = pgTable(
  "provider_consumers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider_key: text("provider_key").notNull(),
    consumer: text("consumer").notNull(),
    capability: text("capability").notNull(),
    calls_24h: integer("calls_24h").notNull().default(0),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
    refreshed_at: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Unique (provider_key, consumer, capability) enforced by index in 0045.
    providerIdx: index("idx_provider_consumers_provider").on(t.provider_key),
    consumerIdx: index("idx_provider_consumers_consumer").on(t.consumer),
  }),
);

export type ProviderCallSiteRow = typeof providerCallSites.$inferSelect;
export type NewProviderCallSiteRow = typeof providerCallSites.$inferInsert;
export type ProviderConsumerRow = typeof providerConsumers.$inferSelect;
export type NewProviderConsumerRow = typeof providerConsumers.$inferInsert;
