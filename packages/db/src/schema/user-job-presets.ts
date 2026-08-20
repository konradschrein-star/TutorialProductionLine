import { pgTable, uuid, varchar, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { contentTemplates } from "./content-templates.js";

/**
 * User Job Presets Table
 *
 * Stores saved preset configurations for job creation forms.
 * Each user can save multiple presets per template.
 *
 * JSONB settings column contains:
 * - channel_id: string
 * - production_version: "V1" | "V2" | "V3"
 * - subtitles: boolean
 * - skip_image_qc: boolean
 * - skip_final_qc: boolean
 * - language: string
 * - environment_id: string | null (for illustration formats)
 * - any other template-specific defaults
 *
 * Foreign key constraints:
 * - users.id (CASCADE on delete - remove user's presets when user deleted)
 * - content_templates.id (CASCADE on delete - remove presets when template deleted)
 *
 * Unique constraint:
 * - (user_id, template_id, preset_name) - prevent duplicate preset names per user/template
 */
export const userJobPresets = pgTable("user_job_presets", {
  id: uuid("id").primaryKey().defaultRandom(),

  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  template_id: uuid("template_id")
    .notNull()
    .references(() => contentTemplates.id, { onDelete: "cascade" }),

  preset_name: varchar("preset_name", { length: 100 }).notNull(),

  settings: jsonb("settings")
    .$type<{
      channel_id: string;
      production_version: "V1" | "V2" | "V3";
      subtitles: boolean;
      skip_image_qc: boolean;
      skip_final_qc: boolean;
      language: string;
      environment_id?: string | null;
      [key: string]: unknown;
    }>()
    .notNull(),

  is_default: boolean("is_default").notNull().default(false),

  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
