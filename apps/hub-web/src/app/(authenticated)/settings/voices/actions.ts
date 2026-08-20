"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  createTTSVoice,
  updateTTSVoice,
  deleteTTSVoice,
} from "@repo/db/repositories";
import { ttsVoices } from "@repo/db/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";

/**
 * TTS voice mutations.
 *
 * `createTTSVoice` / `updateTTSVoice` / `deleteTTSVoice` already existed in
 * @repo/db with no caller — the Voices page rendered an "Add Voice" button and
 * an edit pencil that only flipped React state and rendered nothing. These
 * actions connect them.
 */

export interface VoiceActionResult {
  success: boolean;
  error?: string;
}

const VoiceInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  provider: z.string().trim().min(1, "Provider is required").max(50),
  voice_id: z.string().trim().min(1, "Voice ID is required").max(255),
  language: z.string().trim().min(1, "Language is required").max(10),
  gender: z.string().trim().max(20).optional().nullable(),
  style: z.string().trim().max(50).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
  /** Raw JSON text as typed by the operator; the column is `text`, not jsonb. */
  settings: z.string().optional().nullable(),
});

export type VoiceInputData = z.infer<typeof VoiceInput>;

async function assertCanEdit(): Promise<string | null> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return "You do not have permission to change voices.";
  }
  return null;
}

function normalise(data: VoiceInputData) {
  return {
    name: data.name,
    provider: data.provider,
    voice_id: data.voice_id,
    language: data.language.toLowerCase(),
    gender: data.gender?.trim() ? data.gender.trim() : null,
    style: data.style?.trim() ? data.style.trim() : null,
    description: data.description?.trim() ? data.description.trim() : null,
    is_active: data.is_active,
    settings: data.settings?.trim() ? data.settings.trim() : null,
  };
}

/** Reject malformed JSON up front rather than writing garbage into the column. */
function validateSettingsJson(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  try {
    JSON.parse(raw);
    return null;
  } catch {
    return 'Provider settings must be valid JSON, e.g. {"speed": 1.1}';
  }
}

export async function createVoiceAction(
  input: VoiceInputData,
): Promise<VoiceActionResult> {
  const denied = await assertCanEdit();
  if (denied) return { success: false, error: denied };

  const parsed = VoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const jsonError = validateSettingsJson(parsed.data.settings);
  if (jsonError) return { success: false, error: jsonError };

  try {
    await createTTSVoice(db, { ...normalise(parsed.data), is_default: false });
    revalidatePath("/settings/voices");
    return { success: true };
  } catch (error) {
    console.error("[voices] create failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not create voice",
    };
  }
}

export async function updateVoiceAction(
  id: string,
  input: VoiceInputData,
): Promise<VoiceActionResult> {
  const denied = await assertCanEdit();
  if (denied) return { success: false, error: denied };

  const parsed = VoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const jsonError = validateSettingsJson(parsed.data.settings);
  if (jsonError) return { success: false, error: jsonError };

  try {
    const updated = await updateTTSVoice(db, id, normalise(parsed.data));
    if (!updated) return { success: false, error: "Voice no longer exists" };
    revalidatePath("/settings/voices");
    return { success: true };
  } catch (error) {
    console.error("[voices] update failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not update voice",
    };
  }
}

export async function deleteVoiceAction(
  id: string,
): Promise<VoiceActionResult> {
  const denied = await assertCanEdit();
  if (denied) return { success: false, error: denied };

  try {
    const removed = await deleteTTSVoice(db, id);
    if (!removed) return { success: false, error: "Voice no longer exists" };
    revalidatePath("/settings/voices");
    return { success: true };
  } catch (error) {
    console.error("[voices] delete failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not delete voice",
    };
  }
}

/**
 * Set the default voice for a provider+language pair, addressed by PRIMARY KEY.
 *
 * This deliberately does not call `setDefaultVoice()` from @repo/db. That
 * helper resolves the voice with `getTTSVoiceById()`, which queries the
 * `voice_id` column, and then hands the same value to `updateTTSVoice()`,
 * which filters on the `id` primary key. Callers pass a UUID, the lookup
 * matches nothing, and it returns null — which is why the star button on this
 * page (and POST /api/voices/[id]/set-default behind it) never did anything.
 * Fixing the repository is outside this page's ownership; reported instead.
 */
export async function setDefaultVoiceAction(
  id: string,
): Promise<VoiceActionResult> {
  const denied = await assertCanEdit();
  if (denied) return { success: false, error: denied };

  try {
    const [voice] = await db
      .select()
      .from(ttsVoices)
      .where(eq(ttsVoices.id, id))
      .limit(1);
    if (!voice) return { success: false, error: "Voice not found" };

    await db
      .update(ttsVoices)
      .set({ is_default: false, updated_at: new Date() })
      .where(
        and(
          eq(ttsVoices.provider, voice.provider),
          eq(ttsVoices.language, voice.language),
        ),
      );

    await db
      .update(ttsVoices)
      .set({ is_default: true, updated_at: new Date() })
      .where(eq(ttsVoices.id, id));

    revalidatePath("/settings/voices");
    return { success: true };
  } catch (error) {
    console.error("[voices] set default failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not set default",
    };
  }
}
