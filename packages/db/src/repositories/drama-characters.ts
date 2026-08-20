/**
 * Drama Characters Repository
 *
 * Data access layer for drama_characters and channel_drama_characters tables.
 * Manages character definitions and channel-specific character assignments.
 */

import { eq, inArray, and, isNull, sql } from "drizzle-orm";
import {
  dramaCharacters,
  channelDramaCharacters,
} from "../schema/drama-characters.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

// Type for a drama character record
export type DramaCharacter = typeof dramaCharacters.$inferSelect;

// Type for a channel-drama character association
export type ChannelDramaCharacter = typeof channelDramaCharacters.$inferSelect;

/**
 * Get drama characters by IDs
 *
 * @param ids - Array of character IDs
 * @param tx - Optional transaction
 * @returns Array of drama characters
 */
export async function getDramaCharactersByIds(
  ids: string[],
  tx?: Transaction,
): Promise<DramaCharacter[]> {
  const db = getDbOrTx(tx);

  if (ids.length === 0) return [];

  return await db
    .select()
    .from(dramaCharacters)
    .where(inArray(dramaCharacters.id, ids));
}

/**
 * Get default drama characters for a channel
 *
 * Returns characters that are marked as default for the specified channel.
 *
 * @param channelId - Channel ID
 * @param tx - Optional transaction
 * @returns Array of drama characters with default assignments
 */
export async function getDefaultCharactersForChannel(
  channelId: string,
  tx?: Transaction,
): Promise<DramaCharacter[]> {
  const db = getDbOrTx(tx);

  const results = await db
    .select({ character: dramaCharacters })
    .from(channelDramaCharacters)
    .innerJoin(
      dramaCharacters,
      eq(channelDramaCharacters.character_id, dramaCharacters.id),
    )
    .where(eq(channelDramaCharacters.channel_id, channelId));

  return results.map((r: { character: DramaCharacter }) => r.character);
}

/**
 * Get all preset drama characters
 *
 * Returns characters marked as preset/template characters available globally.
 *
 * @param tx - Optional transaction
 * @returns Array of preset drama characters
 */
export async function getAllPresetCharacters(
  tx?: Transaction,
): Promise<DramaCharacter[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(dramaCharacters)
    .where(eq(dramaCharacters.is_preset, true));
}

/**
 * Update a character's thumbnail URL (reference image for future generations).
 * Only sets the URL if the character doesn't already have one.
 */
export async function updateCharacterThumbnailUrl(
  id: string,
  thumbnailUrl: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(dramaCharacters)
    .set({ thumbnail_url: thumbnailUrl })
    .where(
      and(eq(dramaCharacters.id, id), isNull(dramaCharacters.thumbnail_url)),
    );
}

/**
 * Force-update a character's thumbnail URL (overwrites existing).
 */
export async function setCharacterThumbnailUrl(
  id: string,
  thumbnailUrl: string,
  tx?: Transaction,
): Promise<void> {
  const db = getDbOrTx(tx);
  await db
    .update(dramaCharacters)
    .set({ thumbnail_url: thumbnailUrl })
    .where(eq(dramaCharacters.id, id));
}

/**
 * Find a preset character by case-insensitive name match.
 * Returns null if no matching preset exists. Used by the autonomous
 * character generator to deduplicate before creating a new preset.
 */
export async function findPresetCharacterByName(
  name: string,
  tx?: Transaction,
): Promise<DramaCharacter | null> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .select()
    .from(dramaCharacters)
    .where(
      and(
        eq(dramaCharacters.is_preset, true),
        sql`lower(${dramaCharacters.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Create a new drama character row. Used by the autonomous generator after
 * it has produced a description + portrait. Returns the created character.
 */
export async function createDramaCharacter(
  data: {
    name: string;
    description: string;
    thumbnailUrl?: string | null;
    isPreset?: boolean;
  },
  tx?: Transaction,
): Promise<DramaCharacter> {
  const db = getDbOrTx(tx);
  const [row] = await db
    .insert(dramaCharacters)
    .values({
      name: data.name,
      description: data.description,
      thumbnail_url: data.thumbnailUrl ?? null,
      is_preset: data.isPreset ?? true,
    })
    .returning();
  if (!row) throw new Error("createDramaCharacter: insert returned no row");
  return row;
}
