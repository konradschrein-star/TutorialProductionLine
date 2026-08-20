import { eq } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import { channels } from "../schema/channels.js";
import { ttsVoices } from "../schema/tts-voices.js";

/**
 * The voice a channel narrates with (channels.voice_id → tts_voices).
 * Migration 0060.
 */
export interface ChannelVoice {
  /** tts_voices row id. */
  id: string;
  /** Human label, e.g. "Fish — Analytical Male". */
  name: string;
  /** Provider label as stored in tts_voices, e.g. "Fish", "ELEVENLABS". */
  provider: string;
  /** Provider-specific voice id — for Fish, the 32-hex model reference_id. */
  voice_id: string;
  language: string;
}

/**
 * Resolve the voice bound to a channel, or null when the channel has none
 * (or the channel id is unknown).
 *
 * Returns null rather than throwing: an unbound channel is a legitimate state
 * and the caller falls through to its existing default. It never substitutes
 * a different channel's voice.
 */
export async function getChannelVoice(
  db: DrizzleClient,
  channelId: string,
): Promise<ChannelVoice | null> {
  const [row] = await db
    .select({
      id: ttsVoices.id,
      name: ttsVoices.name,
      provider: ttsVoices.provider,
      voice_id: ttsVoices.voice_id,
      language: ttsVoices.language,
      is_active: ttsVoices.is_active,
    })
    .from(channels)
    .innerJoin(ttsVoices, eq(channels.voice_id, ttsVoices.id))
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!row) return null;
  // A deactivated voice must not be used — treat it as "no binding".
  if (!row.is_active) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    voice_id: row.voice_id,
    language: row.language,
  };
}
