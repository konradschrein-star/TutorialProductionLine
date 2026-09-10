import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tutorialJobs } from "./tutorial-jobs.js";

/** Preferences never delete shared assets or alter their stable URLs. */
export const thumbnailAssetPreferences = pgTable("thumbnail_asset_preferences", {
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  asset_key: text("asset_key").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  include_in_rotation: boolean("include_in_rotation").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ pk: primaryKey({ columns: [table.user_id, table.asset_key] }) }));

/** Mutable editor draft, explicitly separate from selected/approved image bytes. */
export const tutorialThumbnailDrafts = pgTable("tutorial_thumbnail_drafts", {
  tutorial_job_id: uuid("tutorial_job_id").primaryKey().references(() => tutorialJobs.id, { onDelete: "cascade" }),
  layout: jsonb("layout").notNull(),
  revision: integer("revision").notNull().default(1),
  base_thumbnail_id: uuid("base_thumbnail_id"),
  updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
