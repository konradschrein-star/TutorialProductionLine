import { pgTable, uuid, integer, jsonb, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { contentJobs } from "./content-jobs.js";

/**
 * Video Timelines Table
 *
 * Stores the human-editable edit layer for a content job.
 * One row per job — upserted on every save, version counter incremented.
 *
 * The renderer checks this table first when building its render input.
 * If no row exists, it falls back to content_jobs.assembly_manifest directly.
 *
 * The timeline_data JSONB field holds the full VideoTimeline structure
 * (defined in @repo/contracts VideoTimelineSchema).
 *
 * Cascade on job deletion: cleaning up the timeline is free since R2
 * assets are tracked separately in the job's r2_asset_manifest.
 */
export const videoTimelines = pgTable(
  "video_timelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    job_id: uuid("job_id")
      .notNull()
      .unique()
      .references(() => contentJobs.id, { onDelete: "cascade" }),

    version: integer("version").notNull().default(1),

    // Full VideoTimeline JSON — see @repo/contracts VideoTimelineSchema
    timeline_data: jsonb("timeline_data").notNull(),

    // Operator who last saved (username string, not FK — simpler for audit)
    saved_by: varchar("saved_by", { length: 100 }),

    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    jobIdx: index("video_timelines_job_id_idx").on(table.job_id),
  })
);

export type VideoTimelineRow = typeof videoTimelines.$inferSelect;
export type NewVideoTimelineRow = typeof videoTimelines.$inferInsert;
