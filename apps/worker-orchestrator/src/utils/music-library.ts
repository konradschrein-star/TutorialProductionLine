import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { musicLibrary } from "@repo/db";

export interface MusicTrack {
  file_path: string;
  duration_seconds: number;
}

/**
 * Fetch a random selection of music tracks from the library for a given genre.
 *
 * @param db - Drizzle client
 * @param genre - Genre filter (e.g. "space")
 * @param maxTracks - Maximum number of tracks to return (default: 10)
 * @returns Array of music tracks ordered randomly
 * @throws Error if no tracks are found for the genre
 */
export async function getRandomMusicTracks(
  db: DrizzleClient,
  genre: string,
  maxTracks = 10,
): Promise<MusicTrack[]> {
  const rows = await db
    .select({
      file_path: musicLibrary.file_path,
      duration_seconds: musicLibrary.duration_seconds,
    })
    .from(musicLibrary)
    .where(eq(musicLibrary.genre, genre))
    .orderBy(sql`RANDOM()`)
    .limit(maxTracks);

  if (rows.length === 0) {
    throw new Error(`No music tracks found in library for genre "${genre}"`);
  }

  return rows;
}
