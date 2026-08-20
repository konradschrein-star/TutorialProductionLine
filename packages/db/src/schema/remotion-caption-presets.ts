import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const remotionCaptionPresets = pgTable(
  "remotion_caption_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    is_default: boolean("is_default").default(false).notNull(),
    config: jsonb("config")
      .$type<{
        animation_type:
          | "fade"
          | "slideUp"
          | "pop"
          | "typewriter"
          | "smoothHighlight";
        font_family: string; // "Montserrat" | "Inter" | "Arial"
        font_size: number; // default 72
        primary_color: string; // hex, e.g., "#FFFFFF"
        highlight_color: string; // hex, e.g., "#AAFF00"
        position: "top" | "center" | "bottom";
      }>()
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    nameIdx: index("idx_remotion_caption_presets_name").on(table.name),
    defaultIdx: index("idx_remotion_caption_presets_default").on(
      table.is_default,
    ),
  }),
);

export type RemotionCaptionPreset = typeof remotionCaptionPresets.$inferSelect;
export type NewRemotionCaptionPreset =
  typeof remotionCaptionPresets.$inferInsert;
