import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { contentFormatEnum } from "./enums.js";
import { formatStyleLibraries } from "./format-style-libraries.js";
import { archetypes } from "./archetypes.js";

/**
 * Content Templates Table
 *
 * Template registry for format-agnostic pipeline definitions.
 * New content formats are added by inserting template rows, not by
 * modifying backend code.
 *
 * JSONB columns provide flexibility without schema migration pain:
 * - pipeline_stages: string[] - ordered list of pipeline stage names
 * - prompts: Record<string, string> - AI prompts keyed by stage name
 * - render_config: object - render configuration (engine-specific)
 * - required_assets: string[] - asset types needed for this template
 * - metadata: object - arbitrary template-specific data
 *
 * Foreign key constraints:
 * - Referenced by content_jobs.template_id (RESTRICT to prevent accidental deletion)
 */
export const contentTemplates = pgTable("content_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  format: contentFormatEnum("format").notNull(),

  // Pipeline definition (JSONB for flexibility)
  pipeline_stages: jsonb("pipeline_stages").$type<string[]>().notNull(),
  prompts: jsonb("prompts").$type<Record<string, string>>().notNull(),
  render_config: jsonb("render_config")
    .$type<{
      engine: "FFMPEG" | "REMOTION";
      settings: Record<string, unknown>;
    }>()
    .notNull(),
  required_assets: jsonb("required_assets").$type<string[]>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),

  // Style and archetype relationships
  default_style_library_id: uuid("default_style_library_id").references(
    () => formatStyleLibraries.id,
    { onDelete: "set null" },
  ),
  supports_character_tracking: boolean("supports_character_tracking")
    .notNull()
    .default(false),
  archetype_id: uuid("archetype_id").references(() => archetypes.id, {
    onDelete: "set null",
  }),

  // Template lifecycle
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
