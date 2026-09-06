import { eq, desc, sql } from "drizzle-orm";
import { db, channels } from "../db";

/**
 * Channel Repository
 *
 * Data access layer for YouTube channel operations.
 * Channels represent YouTube destinations for published content.
 */

export interface SubtitleConfig {
  font: string;
  fontSize: number;
  colorScheme: "white_black" | "yellow_black" | "black";
}

/**
 * NOTE: this interface is hand-maintained and already drifts from the real
 * `channels` table — description, tags and metadata are all missing. It is not
 * derived from the Drizzle schema, so a new column is invisible here until
 * someone adds it by hand. Worth replacing with `typeof channels.$inferSelect`.
 */
export interface Channel {
  id: string;
  youtube_channel_id: string;
  name: string;
  language: string;
  subtitle_config?: SubtitleConfig | null;
  clip_library_id?: string | null;
  /** Does this channel currently receive tutorial videos? Migration 0059. */
  accepts_tutorials: boolean;
  /**
   * Does this channel currently receive RANKING (tier-list) videos?
   * Migration 0063. Separate from `accepts_tutorials` on purpose — see that
   * migration for why one flag cannot serve both formats.
   */
  accepts_rankings: boolean;
  /**
   * Is this a PRIMARY channel a VA may create ORIGINAL tutorials against?
   * Migration 0064. Secondary (translation-only) channels are excluded from the
   * Create picker; they still receive translated children via the Localize lane.
   */
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ChannelWithJobCount extends Channel {
  job_count: number;
  scheduled_count: number;
  uploaded_count: number;
  verified_upload_count: number;
}

/**
 * List all channels with job counts
 *
 * @returns Array of channels with job counts
 */
export async function listChannels(): Promise<ChannelWithJobCount[]> {
  // This is a tutorial tool: jobs live in tutorial_jobs, not the ContentForge
  // content_jobs table. Counting content_jobs made every channel read "0 jobs".
  const result = await db
    .select({
      channel: channels,
      job_count: sql<number>`cast(count(tj.id) as integer)`,
      scheduled_count: sql<number>`cast(count(tj.id) filter (where tj.uploader_status = 'scheduled') as integer)`,
      uploaded_count: sql<number>`cast(count(tj.id) filter (where tj.uploader_status = 'uploaded' or tj.is_uploaded = true) as integer)`,
      verified_upload_count: sql<number>`cast(count(tj.id) filter (where tj.upload_verified_at is not null) as integer)`,
    })
    .from(channels)
    .leftJoin(sql`tutorial_jobs tj`, sql`${channels.id} = tj.channel_id`)
    .groupBy(channels.id)
    .orderBy(desc(channels.updated_at));

  return result.map((row) => ({
    ...row.channel,
    job_count: row.job_count || 0,
    scheduled_count: row.scheduled_count || 0,
    uploaded_count: row.uploaded_count || 0,
    verified_upload_count: row.verified_upload_count || 0,
  }));
}

/**
 * Get a single channel by ID
 *
 * @param id - Channel ID
 * @returns Channel or null if not found
 */
export async function getChannelById(id: string): Promise<Channel | null> {
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (result.length === 0) return null;
  const row = result[0]!;
  const meta = row.metadata as Record<string, unknown> | null;
  return {
    ...row,
    subtitle_config: (meta?.subtitle_config as SubtitleConfig) ?? null,
  };
}

export async function updateSubtitleConfig(
  id: string,
  config: SubtitleConfig,
): Promise<void> {
  const current = await db
    .select({ metadata: channels.metadata })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);
  const existing = (current[0]?.metadata as Record<string, unknown>) ?? {};
  await db
    .update(channels)
    .set({
      metadata: { ...existing, subtitle_config: config },
      updated_at: new Date(),
    })
    .where(eq(channels.id, id));
}

/**
 * Create a new channel
 *
 * @param data - Channel data
 * @returns Created channel
 */
export async function createChannel(data: {
  youtube_channel_id?: string;
  name: string;
  language?: string;
}): Promise<Channel> {
  // The YouTube channel ID is optional here — a friend can produce and archive
  // tutorials to Drive long before a channel is linked. The column is
  // NOT NULL UNIQUE, so an unlinked channel gets a unique placeholder that the
  // UI renders as "Not linked".
  const youtubeId =
    data.youtube_channel_id && data.youtube_channel_id.trim()
      ? data.youtube_channel_id.trim()
      : `pending-${crypto.randomUUID()}`;

  const result = await db
    .insert(channels)
    .values({
      youtube_channel_id: youtubeId,
      name: data.name,
      language: data.language ?? "en",
      // This is a tutorial tool — every channel should be selectable for
      // tutorials the moment it is created. Defaulting the column to false made
      // new channels invisible to the job picker until fixed by hand in SQL.
      accepts_tutorials: true,
    })
    .returning();

  return result[0];
}

/**
 * Update an existing channel
 *
 * @param id - Channel ID
 * @param data - Updated channel data
 * @returns Updated channel
 */
export async function updateChannel(
  id: string,
  data: Partial<{
    youtube_channel_id: string;
    name: string;
    language: string;
    is_primary: boolean;
  }>,
): Promise<Channel | null> {
  const result = await db
    .update(channels)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(channels.id, id))
    .returning();

  return result.length > 0 ? result[0] : null;
}

/**
 * Delete a channel
 *
 * @param id - Channel ID
 * @returns True if deleted, false if not found
 */
export async function deleteChannel(id: string): Promise<boolean> {
  await db.delete(channels).where(eq(channels.id, id));
  return true;
}
