import {
  pgTable,
  uuid,
  integer,
  text,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { contentJobs } from "./content-jobs.js";

export const dramaClips = pgTable(
  "drama_clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => contentJobs.id, { onDelete: "cascade" }),
    clip_index: integer("clip_index").notNull(),
    section_type: varchar("section_type", { length: 10 })
      .notNull()
      .default("body"), // 'hook' | 'body'
    text: text("text").notNull(),
    start_ms: integer("start_ms").notNull(),
    end_ms: integer("end_ms").notNull(),
    image_prompt: text("image_prompt"),
    image_path: text("image_path"),
    image_status: varchar("image_status", { length: 20 })
      .notNull()
      .default("pending"),
    video_path: text("video_path"),
    video_status: varchar("video_status", { length: 20 })
      .notNull()
      .default("pending"),
    veo_job_id: text("veo_job_id"),
    // Which preset characters from drama_characters appear in this clip.
    // Drives per-clip reference_images for Nano Banana + character_images
    // for VEO i2v. Empty means "use job-level cast fallback".
    character_ids: uuid("character_ids").array().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jobIdIdx: index("drama_clips_job_id_idx").on(t.job_id),
  }),
);
