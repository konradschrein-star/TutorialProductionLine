import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { contentJobs } from "./content-jobs.js";

/**
 * Bundestag Playbook Segment Type
 *
 * Defines the structure of a single segment in the editing timeline.
 * Each segment specifies which clip to use, timing, and subtitle information.
 */
export type BundestagPlaybookSegment = {
  sequence_number: number;
  timestamp_start: number; // Seconds in final video
  timestamp_end: number;
  primary_clip_id: string; // References bundestag_clips.clip_id
  clip_start_offset: number; // Seconds into source clip
  clip_end_offset: number;
  audio_clip_id: string; // Usually same as primary
  subtitle_text: string;
  subtitle_style: "normal" | "emphasis" | "bold";
  overlay_ids?: string[]; // Future: branding asset IDs
  cut_reason: string; // LLM reasoning
  transition: "cut" | "fade" | "wipe";
};

/**
 * Bundestag Playbook Quality Flags Type
 *
 * Validation results from playbook generation.
 * Used to detect issues before rendering.
 */
export type BundestagPlaybookQualityFlags = {
  all_clips_referenced: boolean;
  no_timeline_gaps: boolean;
  audio_continuity_verified: boolean;
  validation_errors: string[];
  validation_warnings: string[];
};

/**
 * Bundestag Playbooks Table
 *
 * Stores LLM-generated editing playbooks with versioning support.
 *
 * A playbook is a structured JSON timeline that defines:
 * - Which clips to use at each moment
 * - Camera switching decisions
 * - Subtitle timing and styling
 * - Transition effects
 *
 * Playbooks are versioned to support iterative regeneration and A/B testing.
 * The same playbook can be used to render multiple video variants (16:9, 9:16, highlights).
 *
 * Production-ready features:
 * - Version tracking with active flag
 * - Quality validation results
 * - LLM generation metadata for debugging
 * - Statistics for performance monitoring
 */
export const bundestagPlaybooks = pgTable(
  "bundestag_playbooks",
  {
    // === Identity ===
    id: uuid("id").primaryKey().defaultRandom(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => contentJobs.id, { onDelete: "cascade" }),

    // === Versioning ===
    version: integer("version").notNull().default(1),
    is_active: boolean("is_active").default(true),

    // === Generation Metadata ===
    generated_at: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    model: varchar("model", { length: 100 }), // "gemini-2.5-flash", "claude-sonnet-4-6"
    editing_style: varchar("editing_style", { length: 50 }), // "dynamic", "conservative", "highlight-focused"

    // === Playbook Data (Structured JSON) ===
    editing_plan: jsonb("editing_plan")
      .$type<BundestagPlaybookSegment[]>()
      .notNull(),
    quality_flags:
      jsonb("quality_flags").$type<BundestagPlaybookQualityFlags>(),

    // === Statistics ===
    total_segments: integer("total_segments"),
    total_duration_seconds: numeric("total_duration_seconds", {
      precision: 10,
      scale: 3,
    }),
    total_cuts: integer("total_cuts"),

    // === Optional: LLM Reasoning (for debugging) ===
    generation_prompt: text("generation_prompt"),
    generation_reasoning: text("generation_reasoning"),

    // === Condensed Transcript Used ===
    condensed_transcript: jsonb("condensed_transcript").$type<
      Array<{
        clip_id: string;
        segments: Array<{
          start_time: number;
          end_time: number;
          text: string;
        }>;
      }>
    >(),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Indexes for common queries
    jobIdIdx: index("bundestag_playbooks_job_id_idx").on(table.job_id),
    activeIdx: index("bundestag_playbooks_active_idx").on(
      table.job_id,
      table.is_active,
    ),
    versionIdx: index("bundestag_playbooks_version_idx").on(
      table.job_id,
      table.version,
    ),

    // Unique constraint: one version per job
    jobVersionUnique: uniqueIndex("bundestag_playbooks_job_version_unique").on(
      table.job_id,
      table.version,
    ),
  }),
);

/**
 * Bundestag Playbooks Relations
 *
 * Defines the relationship between playbooks and their parent job.
 */
export const bundestagPlaybooksRelations = relations(
  bundestagPlaybooks,
  ({ one }) => ({
    job: one(contentJobs, {
      fields: [bundestagPlaybooks.job_id],
      references: [contentJobs.id],
    }),
  }),
);
