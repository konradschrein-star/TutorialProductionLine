import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { channels } from "./channels.js";

/**
 * Narrators Table
 *
 * PNG narrator characters for formats using static image narrators instead of HeyGen video avatars.
 * Each narrator has multiple pose images stored as assets with tags #narrator:{name} + #pose:{action}.
 *
 * **Scope:**
 * - Channel-scoped (one default narrator per channel)
 * - Multiple narrators per channel supported
 * - Future: Cross-channel assignment for crossover episodes (via join table)
 *
 * **Pose Images:**
 * - Stored as assets with asset_type='narrator_pose'
 * - Tagged: #narrator:{narrator_id} + #pose:{pose_name}
 * - Examples: pointing_left, pointing_right, neutral, excited, explaining
 *
 * **Claude Integration:**
 * - Claude receives metadata about all available poses
 * - Selects best pose per scene based on context
 * - Narrator appears in MOST (not all) scenes
 */
export const narrators = pgTable(
  "narrators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description").notNull(),

    // === Channel Assignment ===
    // Primary channel for this narrator
    // ON DELETE CASCADE: Deleting channel deletes narrator
    channel_id: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    // === Status ===
    is_active: boolean("is_active").notNull().default(true),

    // === Default Flag ===
    // One default narrator per channel (enforced by unique index)
    // Default narrator is auto-selected for new jobs on this channel
    is_default: boolean("is_default").notNull().default(false),

    // === Tags ===
    // Free-form tags for filtering/search
    // Example: ['tech', 'casual', 'educational']
    tags: text("tags").array().notNull().default([]),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    channelIdx: index("idx_narrators_channel").on(table.channel_id),
    // Ensure only one default narrator per channel
    uniqueDefaultPerChannel: uniqueIndex(
      "idx_narrators_default_per_channel"
    ).on(table.channel_id, table.is_default).where(sql`${table.is_default} = true`),
  })
);

// Type exports
export type Narrator = typeof narrators.$inferSelect;
export type NewNarrator = typeof narrators.$inferInsert;
