import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Archetypes Table
 *
 * An archetype defines the visual and structural style DNA for a class of
 * content — independent of topic (channel) or content structure (format).
 *
 * Examples: FLAT_ILLUSTRATION, BROADCAST_NEWS, WHITEBOARD
 *
 * The same archetype can be applied across multiple channels and formats.
 * Archetypes own the image_style flag that routes prompt enrichment logic
 * in the scene-analysis processor.
 *
 * Before any job using this archetype can generate images, it MUST have at
 * least one approved style_guide asset in the assets table linked to this
 * archetype. This is enforced as a hard gate in asset-collection.ts.
 */
export const archetypes = pgTable("archetypes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  style_prefix: text("style_prefix"),
  style_suffix: text("style_suffix"),
  /**
   * Routes the prompt enrichment path in scene-analysis.ts:
   *   "photorealistic" → buildEnrichedImagePrompt (broadcast photography specs)
   *   "illustration"   → buildIllustrationImagePrompt (flat art, no photography)
   */
  image_style: varchar("image_style", { length: 30 }),
  tags: text("tags").array().notNull().default([]),
  metadata: jsonb("metadata"), // stores forbidden_elements, color_palette, typography_rules, etc.
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Archetype = typeof archetypes.$inferSelect;
export type NewArchetype = typeof archetypes.$inferInsert;
