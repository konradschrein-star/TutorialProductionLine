import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const subtitlePresets = pgTable(
  "subtitle_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    engine: varchar("engine", { length: 10 }).notNull(),
    // Typed as opaque Record to avoid cross-package dep on @repo/media-core.
    // Consumers cast to RemotionSubtitleConfig | FFmpegSubtitleConfig by engine discriminant.
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    schema_version: integer("schema_version").notNull().default(2),
    sort_order: integer("sort_order"),
    tags: text("tags").array().notNull().default([]),
    thumbnail_key: text("thumbnail_key"),
    is_built_in: boolean("is_built_in").notNull().default(false),
    // Edit gate (migration 0040). Seeded from is_built_in, but independent of
    // it: a built-in can be unlocked and edited in place, a user preset can be
    // locked to protect it. Deletion stays gated on is_built_in.
    is_locked: boolean("is_locked").notNull().default(false),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    engineIdx: index("idx_subtitle_presets_engine").on(t.engine),
    activeIdx: index("idx_subtitle_presets_active").on(t.is_active),
  }),
);

export const subtitlePresetAssignments = pgTable(
  "subtitle_preset_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    preset_id: uuid("preset_id")
      .notNull()
      .references(() => subtitlePresets.id, { onDelete: "cascade" }),
    format: varchar("format", { length: 50 }),
    channel_id: uuid("channel_id"),
    is_active: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    uniqueAssignment: unique(
      "uq_subtitle_preset_assignments_format_channel",
    ).on(t.format, t.channel_id),
    presetIdx: index("idx_subtitle_preset_assignments_preset").on(t.preset_id),
  }),
);

export type SubtitlePreset = typeof subtitlePresets.$inferSelect;
export type NewSubtitlePreset = typeof subtitlePresets.$inferInsert;
export type SubtitlePresetAssignment =
  typeof subtitlePresetAssignments.$inferSelect;
export type NewSubtitlePresetAssignment =
  typeof subtitlePresetAssignments.$inferInsert;
