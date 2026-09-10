import {
  pgTable,
  varchar,
  jsonb,
  timestamp,
  uuid,
  check,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/**
 * System Settings Table
 *
 * Singleton row storing global system configuration.
 * Each JSONB column represents one settings section.
 * NULL column = use env var / hardcoded defaults.
 *
 * The CHECK constraint ensures only one row can exist (id must be 'singleton').
 * All settings are validated against Zod schemas in @repo/contracts
 * before being written.
 */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: varchar("id", { length: 20 }).primaryKey().default("singleton"),

    // Dropped by migration 0047 (§3.3): general, pipeline, ai_services,
    // rendering, channels, security. Credentials now live in encrypted_secrets;
    // render engine / QMS strictness are per-format, not platform-global.

    /** Asset retention (days) + max upload size (bytes). Reworked by 0047 / T5. */
    storage: jsonb("storage"),

    /** Telegram alert config (reworked by T6). Token lives in encrypted_secrets. */
    notifications: jsonb("notifications"),

    /** Non-secret controls for the separate YouTube uploader. */
    uploader: jsonb("uploader"),
    tutorialDispatchPaused: boolean("tutorial_dispatch_paused").notNull().default(false),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),

    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (table) => [check("singleton_check", sql`${table.id} = 'singleton'`)],
);
