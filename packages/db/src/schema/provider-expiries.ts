/**
 * Provider expiry / subscription clocks (migration 0043).
 *
 * A single provider can carry SEVERAL independent clocks — a subscription, an
 * API key, a licence, a cookie file, an OAuth token, a credit balance — each
 * with its own expiry and its own evidence of when we last verified it. This
 * table is the generic version of what used to be five hardcoded special cases
 * (forge-api subscription, fastgen licence, Fish key 2026-08-01, yt-dlp
 * cookies, claude-pool subscription).
 *
 * `expires_at` is NEVER guessed. `source = 'manual'` with a null `expires_at`
 * means "we do not know — tell us", which the UI renders as an explicit prompt
 * rather than a fake green.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const providerExpiries = pgTable(
  "provider_expiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** FK (by slug) to the catalog / providers.key. */
    provider_key: text("provider_key").notNull(),
    /** subscription | licence | api_key | cookie_file | oauth_token | credit_balance */
    kind: text("kind").notNull(),
    /** Human name, e.g. "Google Flow entitlement". */
    label: text("label").notNull(),
    /** null + source='manual' = "unknown, ask the operator". Never guessed. */
    expires_at: timestamp("expires_at", { withTimezone: true }),
    /** manual | probe | file_mtime | cookie_parse | api — how we learned it. */
    source: text("source").notNull().default("manual"),
    /** Warn this many days before expiry. */
    warn_days_before: integer("warn_days_before").notNull().default(14),
    /** When a probe/parse last confirmed this clock. */
    last_verified_at: timestamp("last_verified_at", { withTimezone: true }),
    /** What we saw (cookie earliest-expiry, credit count, HTTP body, …). */
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
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
    // Uniqueness (provider_key, kind, label) is enforced by a unique index in
    // migration 0043; declared here as a plain index so lookups plan well.
    providerIdx: index("idx_provider_expiries_provider").on(t.provider_key),
    expiresIdx: index("idx_provider_expiries_expires").on(t.expires_at),
  }),
);

export type ProviderExpiryRow = typeof providerExpiries.$inferSelect;
export type NewProviderExpiryRow = typeof providerExpiries.$inferInsert;
