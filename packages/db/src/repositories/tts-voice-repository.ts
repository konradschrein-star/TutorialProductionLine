import { eq, and } from "drizzle-orm";
import type { DrizzleClient } from "../client.js";
import {
  ttsVoices,
  type TTSVoice,
  type NewTTSVoice,
} from "../schema/tts-voices.js";

/**
 * TTS Voice Repository
 *
 * Manages TTS provider voice configurations.
 */

/**
 * List all TTS voices with optional filtering
 */
export async function listTTSVoices(
  db: DrizzleClient,
  filter?: {
    provider?: string;
    language?: string;
    is_active?: boolean;
  },
): Promise<TTSVoice[]> {
  const conditions = [];

  if (filter?.provider) {
    conditions.push(eq(ttsVoices.provider, filter.provider));
  }

  if (filter?.language) {
    conditions.push(eq(ttsVoices.language, filter.language));
  }

  if (filter?.is_active !== undefined) {
    conditions.push(eq(ttsVoices.is_active, filter.is_active));
  }

  if (conditions.length === 0) {
    return db
      .select()
      .from(ttsVoices)
      .orderBy(ttsVoices.provider, ttsVoices.name);
  }

  return db
    .select()
    .from(ttsVoices)
    .where(and(...conditions))
    .orderBy(ttsVoices.provider, ttsVoices.name);
}

/**
 * Get default voice for a provider and language
 */
export async function getDefaultVoice(
  db: DrizzleClient,
  provider: string,
  language: string,
): Promise<TTSVoice | null> {
  const [voice] = await db
    .select()
    .from(ttsVoices)
    .where(
      and(
        eq(ttsVoices.provider, provider),
        eq(ttsVoices.language, language),
        eq(ttsVoices.is_default, true),
        eq(ttsVoices.is_active, true),
      ),
    )
    .limit(1);

  return voice ?? null;
}

/**
 * Get voice by database ID (UUID primary key)
 */
export async function getTTSVoiceByDatabaseId(
  db: DrizzleClient,
  id: string,
): Promise<TTSVoice | null> {
  const [voice] = await db
    .select()
    .from(ttsVoices)
    .where(eq(ttsVoices.id, id))
    .limit(1);

  return voice ?? null;
}

/**
 * Get voice by voice_id (provider-specific voice identifier)
 */
export async function getTTSVoiceById(
  db: DrizzleClient,
  voiceId: string,
): Promise<TTSVoice | null> {
  const [voice] = await db
    .select()
    .from(ttsVoices)
    .where(eq(ttsVoices.voice_id, voiceId))
    .limit(1);

  return voice ?? null;
}

/**
 * Create a new TTS voice
 */
export async function createTTSVoice(
  db: DrizzleClient,
  data: Omit<NewTTSVoice, "id" | "created_at" | "updated_at">,
): Promise<TTSVoice> {
  const [voice] = await db
    .insert(ttsVoices)
    .values({
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning();

  return voice;
}

/**
 * Update a TTS voice
 */
export async function updateTTSVoice(
  db: DrizzleClient,
  id: string,
  data: Partial<Omit<TTSVoice, "id" | "created_at" | "updated_at">>,
): Promise<TTSVoice | null> {
  const [updated] = await db
    .update(ttsVoices)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(ttsVoices.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Delete a TTS voice
 */
export async function deleteTTSVoice(
  db: DrizzleClient,
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(ttsVoices)
    .where(eq(ttsVoices.id, id))
    .returning();

  return result.length > 0;
}

/**
 * Set a voice as the default for its provider and language
 * (automatically unsets other defaults for the same provider+language)
 */
export async function setDefaultVoice(
  db: DrizzleClient,
  id: string,
): Promise<TTSVoice | null> {
  // Get the voice to find its provider and language
  const voice = await getTTSVoiceById(db, id);
  if (!voice) return null;

  // Unset all other defaults for this provider+language
  await db
    .update(ttsVoices)
    .set({ is_default: false, updated_at: new Date() })
    .where(
      and(
        eq(ttsVoices.provider, voice.provider),
        eq(ttsVoices.language, voice.language),
      ),
    );

  // Set this voice as default
  return updateTTSVoice(db, id, { is_default: true });
}
