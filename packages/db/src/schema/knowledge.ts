import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Knowledge LMS Tables
 *
 * Provides an internal learning management system for the hub.
 * Supports two access tiers:
 *   - Open (allowed_roles = [])      → all authenticated users (VAs, managers, etc.)
 *   - Restricted (allowed_roles = ['ADMIN', 'VIEWER', ...]) → listed roles only
 *
 * Courses → Chapters → Videos (ordered by order_index)
 * Per-user watch progress and timestamped notes are tracked per video.
 */

// ---------------------------------------------------------------------------
// courses
// ---------------------------------------------------------------------------
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  /** Absolute local path to a thumbnail image, or null. */
  thumbnail_key: text("thumbnail_key"),
  /**
   * Role gate. Empty array = accessible to every authenticated user.
   * Non-empty = only users whose role appears in this list can see/open the course.
   * Example: ['ADMIN', 'VIEWER'] for purchased investor content.
   */
  allowed_roles: text("allowed_roles").array().notNull().default([]),
  is_published: boolean("is_published").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;

// ---------------------------------------------------------------------------
// course_chapters
// ---------------------------------------------------------------------------
export const courseChapters = pgTable("course_chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  course_id: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  /** Lucide icon name to display on module tiles, e.g. 'Rocket', 'BookOpen'. */
  icon: varchar("icon", { length: 50 }),
  /** 0-based sort order within the course. */
  order_index: integer("order_index").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CourseChapter = typeof courseChapters.$inferSelect;
export type NewCourseChapter = typeof courseChapters.$inferInsert;

// ---------------------------------------------------------------------------
// course_videos
// ---------------------------------------------------------------------------
export const courseVideos = pgTable("course_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapter_id: uuid("chapter_id")
    .notNull()
    .references(() => courseChapters.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  /** 0-based sort order within the chapter. */
  order_index: integer("order_index").notNull().default(0),
  /**
   * Absolute local filesystem path to the video file.
   * Convention: {LOCAL_MEDIA_ROOT}/knowledge/{courseId}/{videoId}.mp4
   */
  video_key: text("video_key").notNull(),
  /** Duration in whole seconds, populated after upload. */
  duration_seconds: integer("duration_seconds"),
  /** Absolute local path to a per-video thumbnail, or null. */
  thumbnail_key: text("thumbnail_key"),
  /** Full spoken-word transcript of the video. Null = not yet generated. */
  transcript: text("transcript"),
  /** Long-form written summary / report based on the video content. Null = not yet generated. */
  summary: text("summary"),
  /** Newline-separated list of key takeaways. Null = not yet generated. */
  takeaways: text("takeaways"),
  is_published: boolean("is_published").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CourseVideo = typeof courseVideos.$inferSelect;
export type NewCourseVideo = typeof courseVideos.$inferInsert;

// ---------------------------------------------------------------------------
// video_watch_progress
// ---------------------------------------------------------------------------
export const videoWatchProgress = pgTable(
  "video_watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    video_id: uuid("video_id")
      .notNull()
      .references(() => courseVideos.id, { onDelete: "cascade" }),
    /** Where playback last stopped, in seconds. */
    last_position_seconds: integer("last_position_seconds").notNull().default(0),
    /** Set to true once the user has watched ≥90% of the video. */
    is_completed: boolean("is_completed").notNull().default(false),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    last_viewed_at: timestamp("last_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("video_watch_progress_user_video_uidx").on(
      table.user_id,
      table.video_id
    ),
  ]
);

export type VideoWatchProgress = typeof videoWatchProgress.$inferSelect;
export type NewVideoWatchProgress = typeof videoWatchProgress.$inferInsert;

// ---------------------------------------------------------------------------
// video_notes
// ---------------------------------------------------------------------------
export const videoNotes = pgTable("video_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  video_id: uuid("video_id")
    .notNull()
    .references(() => courseVideos.id, { onDelete: "cascade" }),
  /**
   * Video timestamp for the note, in seconds.
   * Null = general / non-timestamped note.
   */
  timestamp_seconds: integer("timestamp_seconds"),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VideoNote = typeof videoNotes.$inferSelect;
export type NewVideoNote = typeof videoNotes.$inferInsert;
