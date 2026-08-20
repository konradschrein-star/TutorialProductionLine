import { pgTable, uuid, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { archetypes } from "./archetypes.js";
import { channels } from "./channels.js";
import { assets } from "./assets.js";

/**
 * Environments Table
 *
 * An environment is a composed scene setting — background + props + spatial hints.
 * It gives scene analysis a stable reference to produce consistent "locations"
 * across all scenes in a video.
 *
 * Example: "The Office" resolves to:
 *   - background_asset_id: a drawn office background image
 *   - prop_asset_ids: [desk_uuid, plant_uuid, whiteboard_uuid]
 *   - spatial_hints: { character_x_percent: 30, safe_zone_right_percent: 30 }
 *
 * The safe_zone_right_percent hint is injected into the image prompt to keep
 * scene subjects away from the avatar PIP overlay area.
 *
 * NOTE: prop_asset_ids is a uuid[] array for simplicity. If reverse lookup
 * becomes expensive ("which environments use asset X?"), migrate to an
 * environment_props join table: (environment_id, asset_id, order_index).
 * Phase 2 concern — document it now, address it when the query pattern
 * is proven necessary.
 */
export const environments = pgTable("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  archetype_id: uuid("archetype_id").references(() => archetypes.id, { onDelete: "set null" }),
  channel_id: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
  /**
   * The primary background plate image. Referenced as @img5 in the
   * canonical reference injection order.
   */
  background_asset_id: uuid("background_asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "restrict" }),
  /**
   * Array of prop asset UUIDs composited into the scene.
   * Phase 2: replace with environment_props join table if reverse lookup needed.
   */
  prop_asset_ids: uuid("prop_asset_ids").array().notNull().default([]),
  /**
   * Spatial layout hints for the prompt builder and render engine:
   *   character_x_percent:     where to position the character (0 = left edge)
   *   character_scale:         relative scale of character (1.0 = full height)
   *   safe_zone_right_percent: keep this percentage of the right edge clear
   *                            (for AVATAR_PIP overlay)
   */
  spatial_hints: jsonb("spatial_hints"),
  tags: text("tags").array().notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
