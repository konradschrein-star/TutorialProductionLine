import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const captionPresets = pgTable(
  "caption_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    is_default: boolean("is_default").default(false).notNull(),
    config: jsonb("config")
      .$type<{
        position: string;
        vertical_offset_percent: number;
        font_family: string; // "Montserrat" | "Inter" | "Arial"
        font_size: number; // 48-96
        primary_color: string; // "#FFFFFF"
        highlight_color: string; // "#AAFF00"
        all_caps: boolean;
        show_punctuation: boolean;
        window_size: number; // 1-8
        outline_width: number; // 2-6 (px)
        shadow_offset: number;
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
    nameIdx: index("idx_caption_presets_name").on(table.name),
    defaultIdx: index("idx_caption_presets_default").on(table.is_default),
  }),
);
