import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { channels } from "./channels.js";
import { contentFormatEnum } from "./enums.js";

/**
 * Style Assets Table
 *
 * Stores reusable reference assets (style guides, named personas, backgrounds)
 * for illustration-style content formats (e.g. CASUALLY_EXPLAINED).
 *
 * Files live on the server SSD under LOCAL_MEDIA_ROOT/style-assets/.
 * This table tracks metadata and the absolute path for serving and cleanup.
 *
 * The `description` field is injected verbatim into image generation prompts
 * to achieve visual consistency across all scenes in a job batch.
 *
 * asset_type values:
 *   - 'style_guide'  — overall visual style reference for the format
 *   - 'persona'      — named character (e.g. "Main character: stick figure with glasses")
 *   - 'background'   — scene background option (e.g. "Whiteboard: white board background")
 *
 * channel_id is nullable — null = global (shared across all channels),
 * set = scoped to a specific channel's production.
 */
export const styleAssets = pgTable("style_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description").notNull(),
  asset_type: varchar("asset_type", { length: 50 }).notNull(),
  format: contentFormatEnum("format").notNull(),
  channel_id: uuid("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  file_path: text("file_path").notNull(),
  file_name: varchar("file_name", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type StyleAsset = typeof styleAssets.$inferSelect;
export type NewStyleAsset = typeof styleAssets.$inferInsert;
