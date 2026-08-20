import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Character State Types Table
 *
 * Canonical enum of character emotional/physical states.
 * Pre-seeded with ~12 states. New states can be added by inserting rows.
 *
 * Used for:
 * - Completeness tracking ("character has 4/12 states generated")
 * - Pre-flight QMS checks before scene analysis dispatches image generation
 * - UI labels and state pickers
 * - Auto-labeling hints (the local vision model classifies against these names)
 *
 * Character state assets reference these by name via their tags:
 *   asset.tags includes '#state:neutral', '#state:crying', etc.
 */
export const characterStateTypes = pgTable("character_state_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CharacterStateType = typeof characterStateTypes.$inferSelect;
export type NewCharacterStateType = typeof characterStateTypes.$inferInsert;
