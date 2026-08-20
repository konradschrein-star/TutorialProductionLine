import { eq } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import { musicPresets } from "../schema/music-presets.js";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

/**
 * Music Repository
 *
 * Provides database operations for music presets.
 */

/**
 * Get a music preset by ID.
 *
 * @param db Drizzle client
 * @param id Music preset UUID
 * @returns Music preset record or null if not found
 */
export async function getMusicPresetById(
  db: DrizzleClient,
  id: string,
): Promise<typeof musicPresets.$inferSelect | null> {
  const [preset] = await db
    .select()
    .from(musicPresets)
    .where(eq(musicPresets.id, id))
    .limit(1);

  return preset ?? null;
}

/**
 * Verify that a music file exists and is readable.
 *
 * @param filePath Absolute path to music file
 * @returns True if file exists and is readable, false otherwise
 */
export async function verifyMusicFileExists(
  filePath: string,
): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
