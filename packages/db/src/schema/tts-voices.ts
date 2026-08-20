import { pgTable, uuid, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * TTS Voice Configurations
 *
 * Stores voice IDs for different TTS providers (ElevenLabs, Minimax, etc.)
 * Allows switching between providers without code changes.
 */
export const ttsVoices = pgTable("tts_voices", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Voice identification
  name: varchar("name", { length: 120 }).notNull(), // "English Male - Professional"
  provider: varchar("provider", { length: 50 }).notNull(), // "ElevenLabs", "Minimax", "AI33"
  voice_id: varchar("voice_id", { length: 255 }).notNull(), // Provider-specific voice ID

  // Voice characteristics
  language: varchar("language", { length: 10 }).notNull(), // "en", "de", etc.
  gender: varchar("gender", { length: 20 }), // "male", "female", "neutral"
  style: varchar("style", { length: 50 }), // "professional", "casual", "dramatic"

  // Usage metadata
  description: text("description"), // "Deep, authoritative voice for political commentary"
  is_default: boolean("is_default").notNull().default(false), // Default voice for this provider+language
  is_active: boolean("is_active").notNull().default(true),

  // Provider-specific settings (JSONB for flexibility)
  settings: text("settings"), // JSON: { speed: 1.3, pitch: 0, volume: 1.0, model: "speech-2.8-hd" }

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TTSVoice = typeof ttsVoices.$inferSelect;
export type NewTTSVoice = typeof ttsVoices.$inferInsert;
