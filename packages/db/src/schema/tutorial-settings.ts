import {
  pgTable,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

// single-row settings; id is a fixed guard value of 1
export const tutorialSettings = pgTable("tutorial_settings", {
  id: integer("id").primaryKey().default(1),
  default_script_provider: text("default_script_provider")
    .notNull()
    .default("gemini_pool"),
  default_script_model: text("default_script_model"),
  default_tts_provider: text("default_tts_provider")
    .notNull()
    .default("ai33_elevenlabs"),
  default_tts_voice: text("default_tts_voice").notNull().default(""),
  default_playback_speed: numeric("default_playback_speed", {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default("1.00"),
  record_hotkey: text("record_hotkey").notNull().default("F8"),
  retention_hours: integer("retention_hours").notNull().default(48),
  drive_autoupload_enabled: boolean("drive_autoupload_enabled")
    .notNull()
    .default(false),
  thumbnail_generation_mode: text("thumbnail_generation_mode")
    .notNull()
    .default("ai"),
  thumbnail_background_rotation: jsonb("thumbnail_background_rotation")
    .$type<string[]>()
    .notNull()
    .default(["Modern Minimal Tech", "Neon Glow Studio", "Dark Corporate Slate", "Abstract Gradient Blue"]),
  thumbnail_persona_rotation: jsonb("thumbnail_persona_rotation")
    .$type<Record<string, string[]>>()
    .notNull()
    .default({}),
  default_voice_settings: jsonb("default_voice_settings").$type<
    Record<string, unknown>
  >(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
