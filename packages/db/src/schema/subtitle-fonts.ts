import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export interface SubtitleFontWeight {
  weight: number;
  label: string;
  file_path: string;
}

export const subtitleFonts = pgTable(
  "subtitle_fonts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    file_name: varchar("file_name", { length: 255 }).notNull(),
    file_path: varchar("file_path", { length: 500 }).notNull(),
    format: varchar("format", { length: 10 }).notNull(),
    // CSS family name used in @font-face.
    family: text("family").notNull(),
    // Array of { weight, label, file_path } — variable fonts collapse to one
    // file with a weight range.
    weights: jsonb("weights")
      .$type<SubtitleFontWeight[]>()
      .notNull()
      .default([]),
    is_builtin: boolean("is_builtin").notNull().default(false),
    preview_text: text("preview_text"),
    // 'google' | 'vps' | 'upload'
    source: text("source").notNull().default("upload"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameIdx: index("idx_subtitle_fonts_name").on(t.name),
  }),
);

export type SubtitleFont = typeof subtitleFonts.$inferSelect;
export type NewSubtitleFont = typeof subtitleFonts.$inferInsert;
