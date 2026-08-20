import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { channels } from "./channels.js";

export const dramaCharacters = pgTable("drama_characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  thumbnail_url: text("thumbnail_url"),
  is_preset: boolean("is_preset").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const channelDramaCharacters = pgTable(
  "channel_drama_characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel_id: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    character_id: uuid("character_id")
      .notNull()
      .references(() => dramaCharacters.id, { onDelete: "cascade" }),
    role_label: varchar("role_label", { length: 100 }),
    is_default: boolean("is_default").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    channelIdx: index("channel_drama_chars_channel_idx").on(t.channel_id),
  }),
);
