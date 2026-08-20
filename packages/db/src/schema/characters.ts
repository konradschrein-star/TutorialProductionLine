import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { archetypes } from "./archetypes.js";
import { channels } from "./channels.js";

/**
 * Characters Table
 *
 * A character is a named persona that can appear consistently across scenes
 * and videos. Characters belong to a channel+archetype combination (or are
 * universal if both are null).
 *
 * Character states are stored as assets with:
 *   asset_type = 'character_state'
 *   character_id = this character's ID
 *   tags includes '#state:{state_name}' (e.g. '#state:neutral', '#state:crying')
 *
 * The reference_sheet_asset_id points to a model-sheet image showing the
 * character from multiple angles — used as a reference image when generating
 * new state images for consistency.
 *
 * Completeness is tracked by joining character state assets against the
 * character_state_types table.
 */
export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  /**
   * 'host' — the on-camera face of a channel; what the thumbnail engine resolves.
   * 'cast' — appears in content (drama) but is not the channel's face.
   * Added in migration 0061.
   */
  role: varchar("role", { length: 24 }).notNull().default("host"),
  /** Free-form operator notes (folded in from the old channel_personas.notes). */
  notes: text("notes"),
  /**
   * DERIVED — DO NOT WRITE (migration 0061).
   *
   * Channel binding is owned by `character_channels`; this column is kept in
   * lockstep by a database trigger so the pre-existing drama queries that
   * filter on it keep working. Writing it directly is a no-op: a BEFORE UPDATE
   * trigger overwrites whatever you set with the primary character_channels row.
   */
  channel_id: uuid("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  archetype_id: uuid("archetype_id").references(() => archetypes.id, {
    onDelete: "set null",
  }),
  /**
   * Points to an asset with asset_type='character' — the canonical model sheet
   * showing the character in neutral pose, multiple angles if possible.
   * Used as @img2 in the reference injection chain when generating state images.
   * Nullable because the reference sheet may be uploaded after initial creation.
   *
   * NOTE: No .references() call here by design.
   * assets.ts already imports characters.ts (for the character_id FK on assets),
   * so adding .references(() => assets.id) here would create a circular module
   * dependency (characters → assets → characters). Drizzle cannot resolve circular
   * cross-table references within the same import cycle.
   *
   * The FK constraint is enforced at the database level via the SQL migration:
   *   0011_asset_graph.sql: reference_sheet_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL
   *
   * If you need Drizzle-level FK semantics here in the future, extract both
   * tables into a separate relations file and use Drizzle's `relations()` helper
   * instead of column-level .references(), which avoids the circular import.
   */
  reference_sheet_asset_id: uuid("reference_sheet_asset_id"),
  tags: text("tags").array().notNull().default([]),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Character Images — the "few images" the owner attaches to each character.
 *
 * The whole point of this table is that a character has MANY images and
 * thumbnail generation CYCLES through them, so a channel gets visual variation
 * with a constant face. The old `channel_personas.image_path` held exactly one
 * image, which made cycling impossible.
 *
 * `pose` / `expression` come from the source filenames, which encode them
 * ("Man_pointing_with_smirk", "Bald_bearded_man_surprised_face"). They are
 * preserved so the brief's `gaze_policy` / `emotion_register` can later select a
 * MATCHING pose instead of whatever the cycle lands on.
 */
export const characterImages = pgTable(
  "character_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    character_id: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** Absolute path of the NORMALISED i2i reference image on the media root. */
    image_path: text("image_path").notNull(),
    /** Absolute path of the untouched upload, so a reference can be re-derived. */
    original_path: text("original_path"),
    pose: varchar("pose", { length: 48 }),
    expression: varchar("expression", { length: 48 }),
    source_filename: text("source_filename"),
    width: integer("width"),
    height: integer("height"),
    byte_size: integer("byte_size"),
    /**
     * Stable cycle order. The deterministic picker sorts by
     * (sort_order, created_at, id), so the job -> image mapping never shifts
     * unless the operator deliberately reorders.
     */
    sort_order: integer("sort_order").notNull().default(0),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    characterIdx: index("idx_character_images_character").on(
      t.character_id,
      t.is_active,
      t.sort_order,
    ),
    uniquePath: uniqueIndex("idx_character_images_unique_path").on(
      t.character_id,
      t.image_path,
    ),
  }),
);

/**
 * Character <-> Channel binding. AUTHORITATIVE.
 *
 * The owner: "a character can be assigned to a channel or even multiple
 * channels, but in most cases to one channel". `role='host'` + `is_primary` is
 * what the thumbnail engine resolves for a channel; a partial unique index in
 * SQL guarantees at most one such row per channel.
 */
export const characterChannels = pgTable(
  "character_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    character_id: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    channel_id: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /** 'host' = the channel's on-camera face | 'cast' = appears, not the face. */
    role: varchar("role", { length: 24 }).notNull().default("host"),
    is_primary: boolean("is_primary").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueLink: uniqueIndex("idx_character_channels_unique").on(
      t.character_id,
      t.channel_id,
    ),
    channelIdx: index("idx_character_channels_channel").on(
      t.channel_id,
      t.role,
    ),
  }),
);

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type CharacterImage = typeof characterImages.$inferSelect;
export type NewCharacterImage = typeof characterImages.$inferInsert;
export type CharacterChannel = typeof characterChannels.$inferSelect;
export type NewCharacterChannel = typeof characterChannels.$inferInsert;
