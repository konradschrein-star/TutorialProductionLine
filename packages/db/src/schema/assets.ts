import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  smallint,
  bigint,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { archetypes } from "./archetypes.js";
import { channels } from "./channels.js";
import { characters } from "./characters.js";
import { assetTypeEnum } from "./enums.js";

/**
 * Assets Table
 *
 * The central node in the asset graph. Every visual, audio, or text asset
 * used in production is tracked here with its full provenance and associations.
 *
 * Key design principles:
 * - Flat UUID storage: the UUID is the filename on disk ({uuid}.{ext})
 * - Multi-vector association: channel_id, archetype_id, format are all nullable
 *   (null = universal, applies to all jobs in that dimension)
 * - Tag-based specificity: free-form tags for any additional classification
 * - Origin traceability: real vs AI-generated; AI assets store full generation recipe
 * - Derivation lineage: parent_asset_id tracks parent→child style variants
 *
 * Asset types:
 *   character         — a named character's canonical "master sheet" image
 *   character_state   — a character in a specific state (linked via character_id)
 *   object            — a prop or object (apple, desk, sign) with/without background
 *   background        — a full scene background image
 *   style_guide       — the archetype's visual DNA reference image (REQUIRED per archetype)
 *   color_palette     — a color swatch reference
 *   audio             — background music or SFX
 *   prompt_template   — a stored text prompt template (no file, just text)
 *   video             — video files for job creation (narration, b-roll, etc.)
 *   image             — image files for job creation (thumbnails, visuals, etc.)
 *
 * Resolution tiers (most specific wins):
 *   channel + archetype + format > channel + archetype > archetype + format
 *   > channel only > archetype only > universal (all null)
 *
 * Storage:
 *   SSD: {LOCAL_MEDIA_ROOT}/assets/{uuid}.{ext}
 *   R2:  optional secondary copy for long-term or CDN access
 */
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description").notNull(),

  // Classification
  asset_type: assetTypeEnum("asset_type").notNull(),
  origin: varchar("origin", { length: 20 }).notNull().default("ai_generated"),
  language: varchar("language", { length: 10 }).notNull().default("en"),

  // Multi-vector associations (nullable = universal in that dimension)
  channel_id: uuid("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  archetype_id: uuid("archetype_id").references(() => archetypes.id, {
    onDelete: "set null",
  }),
  format: varchar("format", { length: 50 }),

  // Free-form tags — primary search mechanism
  // Examples: '#no-background', '#state:crying', '#environment:office', '#character:main'
  tags: text("tags").array().notNull().default([]),

  // File storage
  file_path: text("file_path"), // absolute SSD path, null if R2-only
  r2_key: text("r2_key"), // R2 object key, null if SSD-only
  file_name: varchar("file_name", { length: 255 }).notNull(),
  file_format: varchar("file_format", { length: 20 }).notNull(),
  width: integer("width"),
  height: integer("height"),
  size_bytes: bigint("size_bytes", { mode: "number" }),

  // Media asset fields (lazy-generated)
  thumbnail_path: text("thumbnail_path"), // JPEG thumbnail path (video/image)
  waveform_data: jsonb("waveform_data").$type<number[] | null>(), // Amplitude array (audio)
  duration_seconds: integer("duration_seconds"), // Duration (video/audio)

  // Variant lineage metadata — describes how this asset relates to its
  // parent_asset_id (e.g. a compressed/mobile/translated derivative)
  variant_type: varchar("variant_type", { length: 20 }),
  variant_metadata: jsonb("variant_metadata").$type<Record<
    string,
    unknown
  > | null>(),

  // Quality & status
  background_removed: boolean("background_removed").notNull().default(false),
  quality_rating: smallint("quality_rating"), // 1–5, null = unrated
  status: varchar("status", { length: 20 }).notNull().default("draft"),

  // AI generation recipe (set when origin = 'ai_generated')
  // Structure: { model, prompt_template, seed, parameters, generated_at, cost_credits }
  generation_recipe: jsonb("generation_recipe"),

  // Derivation lineage — null for canonical source assets
  parent_asset_id: uuid("parent_asset_id"),

  // Character linkage — set only for asset_type = 'character_state'
  character_id: uuid("character_id").references(() => characters.id, {
    onDelete: "cascade",
  }),

  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
