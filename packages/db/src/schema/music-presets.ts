import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  integer,
  real,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Music Presets Table
 *
 * Stores reusable music files uploaded by users for the video stitcher.
 * Allows users to quickly reference previously uploaded audio files.
 *
 * Foreign key constraints:
 * - users.id (CASCADE on delete - remove user's presets when user deleted)
 *
 * Index:
 * - user_id for fast lookups of presets by user
 */
export const musicPresets = pgTable(
  "music_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 100 }).notNull(),

    file_path: text("file_path").notNull(),

    original_filename: varchar("original_filename", { length: 255 }).notNull(),

    // Metadata fields for filtering and discovery
    mood: text("mood").array(),

    bpm: integer("bpm"),

    genre: varchar("genre", { length: 100 }),

    duration_seconds: real("duration_seconds"),

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("idx_music_presets_user_id").on(table.user_id),
  }),
);
