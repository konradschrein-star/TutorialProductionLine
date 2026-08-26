"use server";

import { revalidatePath } from "next/cache";
import {
  createChannel as createChannelRepo,
  updateChannel as updateChannelRepo,
  deleteChannel as deleteChannelRepo,
  updateSubtitleConfig as updateSubtitleConfigRepo,
  type SubtitleConfig,
} from "@/lib/repositories/channel-repository";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Create a new channel
 *
 * @param data - Channel data
 * @returns ActionResult
 */
export async function createChannel(data: {
  youtube_channel_id?: string;
  name: string;
  language?: string;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:channels")) {
      return { success: false, error: "Unauthorized" };
    }

    await createChannelRepo(data);

    revalidatePath("/channels");

    return { success: true };
  } catch (error) {
    console.error("Failed to create channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update an existing channel
 *
 * @param id - Channel ID
 * @param data - Updated channel data
 * @returns ActionResult
 */
export async function updateChannel(
  id: string,
  data: {
    youtube_channel_id: string;
    name: string;
    language?: string;
    is_primary?: boolean;
  },
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:channels")) {
      return { success: false, error: "Unauthorized" };
    }

    const channel = await updateChannelRepo(id, data);

    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    revalidatePath("/channels");
    revalidatePath(`/channels/${id}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to update channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update subtitle config for a channel.
 * Stored in channels.metadata.subtitle_config — no schema migration needed.
 */
export async function updateSubtitleConfig(
  channelId: string,
  config: SubtitleConfig,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:channels")) {
      return { success: false, error: "Unauthorized" };
    }
    await updateSubtitleConfigRepo(channelId, config);
    revalidatePath("/channels");
    return { success: true };
  } catch (error) {
    console.error("Failed to update subtitle config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete a channel
 *
 * @param id - Channel ID
 * @returns ActionResult
 */
export async function deleteChannel(id: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session, "manage:channels")) {
      return { success: false, error: "Unauthorized" };
    }

    const deleted = await deleteChannelRepo(id);

    if (!deleted) {
      return { success: false, error: "Channel not found" };
    }

    revalidatePath("/channels");

    return { success: true };
  } catch (error) {
    console.error("Failed to delete channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
