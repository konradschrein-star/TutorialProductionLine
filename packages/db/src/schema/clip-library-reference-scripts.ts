import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { clipLibraries } from "./clip-library.js";

/**
 * Reference scripts per clip_library. Used by the script-writer step
 * as a stylistic guide. The script-gen layer picks the
 * least-recently-used reference (by last_used_at NULLS FIRST) so the
 * same one doesn't anchor every job.
 */
export const clipLibraryReferenceScripts = pgTable(
  "clip_library_reference_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clip_library_id: uuid("clip_library_id")
      .notNull()
      .references(() => clipLibraries.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    content: text("content").notNull(),
    word_count: integer("word_count").notNull().default(0),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    libIdx: index("clip_library_reference_scripts_lib_idx").on(
      t.clip_library_id,
    ),
  }),
);
