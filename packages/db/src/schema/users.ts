import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";
import { operatorRoleEnum } from "./enums.js";

/**
 * Users Table
 *
 * Represents operator accounts (VAs, admins, managers).
 * Used for RBAC and human-in-the-loop task assignment.
 *
 * Foreign key constraints:
 * - Referenced by content_jobs.assigned_production_va_id (SET NULL to preserve history)
 * - Referenced by content_jobs.assigned_uploader_va_id (SET NULL to preserve history)
 *
 * Soft delete via is_active:
 * - Deactivated users remain in the system to preserve job history
 * - New job assignments should filter to is_active = true only
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  role: operatorRoleEnum("role").notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  is_active: boolean("is_active").notNull().default(true),
  /**
   * The channel this assistant is currently producing tutorials for
   * (migration 0067). Set by them — it is whatever they last picked in the
   * Create form — and used to attribute a job created outside the browser,
   * i.e. one pushed from the Keyword Tool's Produce button, which sends no
   * channel of its own.
   *
   * NULL means "they have never picked one", and a job that would depend on it
   * is refused rather than attributed to a guessed brand.
   */
  default_tutorial_channel_id: uuid("default_tutorial_channel_id"),
  last_seen_at: timestamp("last_seen_at", { withTimezone: true }),
  online_seconds_total: bigint("online_seconds_total", { mode: "number" })
    .notNull()
    .default(0),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
