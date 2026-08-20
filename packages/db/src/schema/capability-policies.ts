/**
 * Capability fallback policies (migration 0043).
 *
 * "Fail instead of degrading." A policy makes fallback behaviour EXPLICIT and
 * OPT-IN for a capability (globally, or for one consumer). This is the direct
 * fix for the Nano-Banana-2 → Seedream-4.5 silent downgrade that shipped bad
 * thumbnails for weeks: with `strict = true` the gateway throws with the full
 * chain in the error instead of quietly serving a worse provider.
 *
 *   strict              never use a chain position > 1; throw on primary-down
 *   max_fallback_depth  cap how far down the chain a fallback may reach
 *   require_ack         a fallback needs an operator acknowledgement first
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const capabilityPolicies = pgTable(
  "capability_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** image | video | tts | llm | music | footage */
    capability: text("capability").notNull(),
    /** null = the global policy for this capability; else a consumer override. */
    consumer: text("consumer"),
    /** Never fall back — throw with diagnostics when position 1 is ineligible. */
    strict: boolean("strict").notNull().default(false),
    /** null = no depth cap (chain length is the only bound). */
    max_fallback_depth: integer("max_fallback_depth"),
    require_ack: boolean("require_ack").notNull().default(false),
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
    // Partial unique indexes (global vs consumer) live in migration 0043.
    lookupIdx: index("idx_capability_policies_lookup").on(
      t.capability,
      t.consumer,
    ),
  }),
);

export type CapabilityPolicyRow = typeof capabilityPolicies.$inferSelect;
export type NewCapabilityPolicyRow = typeof capabilityPolicies.$inferInsert;
