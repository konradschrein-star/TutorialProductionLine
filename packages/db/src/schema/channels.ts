import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { ttsVoices } from "./tts-voices.js";

/**
 * Channels Table
 *
 * Represents YouTube channel entities.
 * Each channel can have multiple content jobs.
 *
 * Foreign key constraints:
 * - Referenced by content_jobs.channel_id (RESTRICT to prevent accidental deletion)
 */
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  youtube_channel_id: varchar("youtube_channel_id", { length: 50 })
    .notNull()
    .unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  metadata: jsonb("metadata"), // linguistic identity, branding notes, etc.
  // Is this channel currently receiving tutorial videos? See migration 0059.
  // Distinguishes the 3 live tutorial channels from the drama channel, the
  // 'UCxxxxxxxxxxxxxxxx' placeholder, the unconnected Ecom Notebook and the
  // test row — all of which the job-creation picker used to offer equally.
  // Defaults false so a new channel is opt-in, never silently selectable.
  accepts_tutorials: boolean("accepts_tutorials").notNull().default(false),
  // Same idea for the RANKING lane, deliberately a SEPARATE flag (migration
  // 0063). A tier-list channel and a tutorial channel are different products,
  // so one boolean cannot answer both questions: reusing accepts_tutorials
  // would mean enabling a ranking-only channel also offers it for tutorials,
  // and a VA would record a screen capture into a tier-list channel.
  accepts_rankings: boolean("accepts_rankings").notNull().default(false),
  // Is this a PRIMARY channel a VA may create original tutorials against?
  // Migration 0064. The friend's line has ONE primary channel (USA/English);
  // its German/French/Italian/Dutch/Swedish counterparts are SECONDARY —
  // they only ever receive *translations* produced from the primary via the
  // Localize lane, so a VA must never be able to start an original job (or,
  // worse, an original job in a mismatched language) against them. The Create
  // picker filters on this flag; Localize/translate routing keeps using
  // language + accepts_tutorials, so secondary channels stay valid targets.
  is_primary: boolean("is_primary").notNull().default(false),
  // Per-channel clip library (drama stock-chain template). Many
  // channels can point at the same clip library so libraries can
  // be shared.
  clip_library_id: uuid("clip_library_id"),
  // The channel's narration voice (tts_voices row). See migration 0060.
  //
  // WHY: nothing tied a voice to a channel — tutorial_jobs.tts_voice is a
  // free-text field typed per job, and the settings default was a stale
  // Minimax id, so EVERY tutorial silently fell back to the hardcoded Fish
  // "Alok" voice regardless of which channel it was for.
  //
  // Deliberately a plain nullable FK and NOT unique: one voice may serve
  // several channels (Entrepreneurs Skool and Your VirtualFD share one).
  // NULL = no channel voice, fall through to the existing default chain.
  voice_id: uuid("voice_id").references(() => ttsVoices.id, {
    onDelete: "set null",
  }),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
