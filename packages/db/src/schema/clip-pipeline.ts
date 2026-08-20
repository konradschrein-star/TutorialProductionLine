import {
  pgTable,
  uuid,
  varchar,
  text,
  smallint,
  boolean,
  jsonb,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { contentFormatEnum } from "./enums.js";
import { clipLibraries } from "./clip-library.js";
import { contentJobs } from "./content-jobs.js";

// ── clip_library_configs ───────────────────────────────────────────────────
// Per-format clip library configuration. channel_id null = applies to all channels for this format.
export const clipLibraryConfigs = pgTable(
  "clip_library_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    format: contentFormatEnum("format").notNull(),
    channel_id: uuid("channel_id"),
    clip_library_id: uuid("clip_library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "restrict" }),
    clip_selection_enabled: boolean("clip_selection_enabled")
      .notNull()
      .default(false),
    hitl_clip_review: boolean("hitl_clip_review").notNull().default(true),
    clips_per_sentence: smallint("clips_per_sentence").notNull().default(1),
    min_gap_before_repeat: smallint("min_gap_before_repeat")
      .notNull()
      .default(5),
    // off | soft | strict
    character_continuity: varchar("character_continuity", { length: 20 })
      .notNull()
      .default("off"),
    broll_fallback_enabled: boolean("broll_fallback_enabled")
      .notNull()
      .default(true),
    broll_fallback_model: varchar("broll_fallback_model", { length: 100 }),
    // FormatPlaybook JSON — see @repo/contracts FormatPlaybookSchema
    playbook: jsonb("playbook").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    formatChannelIdx: index("clip_library_configs_format_channel_idx").on(
      t.format,
      t.channel_id,
    ),
    libraryIdx: index("clip_library_configs_library_id_idx").on(
      t.clip_library_id,
    ),
  }),
);

// ── job_edit_lists ─────────────────────────────────────────────────────────
// Versioned edit lists per job.
// status lifecycle: ai_pending → ai_complete → needs_review → approved | rejected | stale
// v1 = AI-generated; v2+ = human-patched
export const jobEditLists = pgTable(
  "job_edit_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => contentJobs.id, { onDelete: "cascade" }),
    version: smallint("version").notNull().default(1),
    // ai_pending | ai_complete | needs_review | approved | rejected | stale
    status: varchar("status", { length: 30 }).notNull().default("ai_pending"),
    // Array of EditListEntry — see @repo/contracts EditListSchema
    entries: jsonb("entries").notNull(),
    // SHA-256 of content_jobs.script at generation time.
    // If job script changes, this list becomes stale and render is blocked.
    source_script_hash: varchar("source_script_hash", { length: 64 }),
    total_clips: smallint("total_clips").notNull().default(0),
    unique_clips: smallint("unique_clips").notNull().default(0),
    total_duration_ms: integer("total_duration_ms").notNull().default(0),
    ai_fallback_count: smallint("ai_fallback_count").notNull().default(0),
    reviewed_by: uuid("reviewed_by"),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    // Set to true when render starts — prevents concurrent re-render of same version
    locked_for_render: boolean("locked_for_render").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jobVersionIdx: index("job_edit_lists_job_version_idx").on(
      t.job_id,
      t.version,
    ),
    jobIdx: index("job_edit_lists_job_id_idx").on(t.job_id),
    statusIdx: index("job_edit_lists_status_idx").on(t.status),
  }),
);

// ── clip_usage ─────────────────────────────────────────────────────────────
// Tracks every clip used in every rendered video for analytics and dedup.
export const clipUsage = pgTable(
  "clip_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clip_id: uuid("clip_id").notNull(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => contentJobs.id, { onDelete: "cascade" }),
    edit_list_id: uuid("edit_list_id").notNull(),
    sentence_index: smallint("sentence_index").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clipIdx: index("clip_usage_clip_id_idx").on(t.clip_id),
    jobIdx: index("clip_usage_job_id_idx").on(t.job_id),
  }),
);
