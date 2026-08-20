import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Claude pool accounts (migration 0051 / plan P1-6).
 *
 * Multi-account as ISOLATION not evasion. `config_dir` is a filesystem path to
 * a CLAUDE_CONFIG_DIR holding an account's OAuth session — this table holds NO
 * credential material (no tokens, no keys). Assignment is static via
 * `assigned_consumers`; there is no rate-limit rotation.
 *
 * Mirrors the CLAUDE_POOL_ACCOUNTS env the pool app reads (apps/claude-pool).
 * System Health renders the accounts sub-table from here (P1-7).
 */
export const llmPoolAccounts = pgTable(
  "llm_pool_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    display_name: text("display_name").notNull(),
    /** CLAUDE_CONFIG_DIR path. NOT a secret — the OAuth session lives in it. */
    config_dir: text("config_dir"),
    plan_label: text("plan_label"),
    owner_note: text("owner_note"),
    enabled: boolean("enabled").notNull().default(false),
    assigned_consumers: text("assigned_consumers")
      .array()
      .notNull()
      .default([]),
    max_concurrent: integer("max_concurrent").notNull().default(2),
    token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
    last_ok_at: timestamp("last_ok_at", { withTimezone: true }),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugIdx: uniqueIndex("llm_pool_accounts_slug_idx").on(t.slug),
  }),
);

/**
 * One row per pool invocation (migration 0051). Answers "which account served
 * this script" and "how close are we to a limit" — zero cost/usage telemetry
 * was one of the pool's fragilities (plan §1.3).
 */
export const llmPoolRuns = pgTable(
  "llm_pool_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    account_slug: text("account_slug").notNull(),
    consumer: text("consumer"),
    format_key: text("format_key"),
    endpoint: text("endpoint").notNull(),
    /** ok | rate_limited | error | busy */
    outcome: text("outcome").notNull(),
    duration_ms: integer("duration_ms"),
    word_count: integer("word_count"),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    accountCreatedIdx: index("llm_pool_runs_account_created_idx").on(
      t.account_slug,
      t.created_at,
    ),
  }),
);
