import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
  smallint,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { assets } from "./assets.js";

/**
 * Format Style Libraries Table
 *
 * Clean, format-first style reference system for visual consistency across content types.
 * Replaces the over-engineered style_collections system with a simpler approach.
 *
 * **Architecture:**
 * - Each library is scoped to a single content format (EXPLAINER, DOCUMENTARY, etc.)
 * - Libraries are global (no channel/archetype complexity)
 * - Supports 1-10+ reference images per library via join table
 * - Text guidelines injected verbatim into AI prompts
 *
 * **Usage:**
 * - Operators create libraries for each format they work with
 * - Upload multiple reference images: style guides, character sheets, layouts, backgrounds
 * - Job creation selects library by format, workers inject references into prompts
 * - Supports composite reference images (multiple views in one file)
 *
 * **Example:**
 * - Library: "Minimalist Tech Explainer"
 * - Format: EXPLAINER
 * - Reference images:
 *   1. style_guide: Composite of 5 canonical frames showing visual style
 *   2. character: Character sheet with multiple poses/expressions
 *   3. layout_reference: Grid layout for AI-generated compositions
 *   4. background: Clean off-white background options
 */
export const formatStyleLibraries = pgTable(
  "format_style_libraries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull(),

    // === Format association (REQUIRED) ===
    // Maps to contentFormatEnum values (EXPLAINER, DOCUMENTARY, etc.)
    format: varchar("format", { length: 50 }).notNull(),

    // === Text styling guidelines ===
    // Injected verbatim into image generation prompts
    // Example: "Style: Simple stick figures, thick black outlines\nBackground: Clean off-white (#FAFAFA)\nForbidden: Gradients on characters, cluttered backgrounds"
    text_guidelines: text("text_guidelines"),

    // === Metadata ===
    // Extensible JSONB for future enhancements
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // === Status ===
    is_active: boolean("is_active").notNull().default(true),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    formatIdx: index("idx_format_style_libraries_format").on(table.format),
    activeIdx: index("idx_format_style_libraries_active").on(table.is_active),
  }),
);

/**
 * Format Style Library Assets Join Table
 *
 * Many-to-many relationship between format style libraries and reference image assets.
 * Allows each library to have multiple reference images with categorization and ordering.
 *
 * **Reference Types (ref_type):**
 * - `style_guide`: Overall visual style composite (multiple views in one image)
 * - `character`: Character sheets with poses/expressions
 * - `layout_reference`: Layout/composition guides for scene arrangement
 * - `background`: Background options
 * - `logo`: Brand logos
 * - `typography`: Typography references
 * - `color_palette`: Color palette guides
 * - `scene_example`: Example scene compositions
 *
 * **Display Order:**
 * - 0-indexed for UI presentation
 * - Lower number = higher priority for AI reference selection
 */
export const formatStyleLibraryAssets = pgTable(
  "format_style_library_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    library_id: uuid("library_id")
      .notNull()
      .references(() => formatStyleLibraries.id, { onDelete: "cascade" }),
    asset_id: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    // === Reference categorization ===
    // Predefined categories (not enum to allow flexibility)
    ref_type: varchar("ref_type", { length: 50 }).notNull(),

    // === Display order ===
    // UI presentation order, also influences AI reference priority
    display_order: smallint("display_order").notNull().default(0),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    libraryIdx: index("idx_format_style_library_assets_library").on(
      table.library_id,
    ),
    assetIdx: index("idx_format_style_library_assets_asset").on(table.asset_id),
    uniqueLibraryAsset: uniqueIndex(
      "idx_format_style_library_assets_unique",
    ).on(table.library_id, table.asset_id),
  }),
);

/**
 * TypeScript types for application use
 */
export type FormatStyleLibrary = typeof formatStyleLibraries.$inferSelect;
export type NewFormatStyleLibrary = typeof formatStyleLibraries.$inferInsert;
export type FormatStyleLibraryAsset =
  typeof formatStyleLibraryAssets.$inferSelect;
export type NewFormatStyleLibraryAsset =
  typeof formatStyleLibraryAssets.$inferInsert;
