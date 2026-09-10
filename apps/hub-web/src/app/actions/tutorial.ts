"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, tutorialPromptPresets } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import {
  createPromptPreset,
  updatePromptPreset,
  updateTutorialSettings,
} from "@repo/db";
import { VoiceSettingsSchema } from "@repo/contracts";

type ActionResult = { success: boolean; error?: string };

// NOTE: per-VA provider key entry was ABOLISHED (Decision §2.1 / D3). Keys now
// live in the ONE secrets area, edited by an admin in Settings → Credentials.
// The old saveTutorialProviderKey action and tutorial-secret-service are deleted.

// ── Prompt presets ───────────────────────────────────────────────────────────

const CreatePromptSchema = z.object({
  category: z.enum([
    "THREE_MIN",
    "SIX_MIN",
    "SIX_MIN_STITCH",
    "LONG_FORM",
    "SHORT_MATCH",
    "SHORT_PLUS",
  ]),
  name: z.string().min(1).max(120),
  system_prompt: z.string().min(10),
});

export async function createTutorialPrompt(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  // A producer VA may tune these workflow settings (edit:tutorial-workflow);
  // manage:tutorial-settings (admin) also qualifies. Credentials/storage/alerts
  // are elsewhere and stay admin-only.
  if (
    !session ||
    !(
      hasPermission(session, "manage:tutorial-settings") ||
      hasPermission(session, "edit:tutorial-workflow")
    )
  ) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = CreatePromptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    await createPromptPreset(db, {
      ...parsed.data,
      created_by: session.userId,
      is_seeded: false,
      is_default: false,
    });
    revalidatePath("/tutorial-studio");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

const UpdatePromptSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  system_prompt: z.string().min(10).optional(),
});

export async function updateTutorialPrompt(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  // A producer VA may tune these workflow settings (edit:tutorial-workflow);
  // manage:tutorial-settings (admin) also qualifies. Credentials/storage/alerts
  // are elsewhere and stay admin-only.
  if (
    !session ||
    !(
      hasPermission(session, "manage:tutorial-settings") ||
      hasPermission(session, "edit:tutorial-workflow")
    )
  ) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = UpdatePromptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const { id, ...data } = parsed.data;
    if (hasPermission(session, "manage:tutorial-settings")) {
      await updatePromptPreset(db, id, data);
    } else {
      const updated = await db.update(tutorialPromptPresets).set(data).where(and(
        eq(tutorialPromptPresets.id, id),
        eq(tutorialPromptPresets.created_by, session.userId),
        eq(tutorialPromptPresets.is_seeded, false),
        eq(tutorialPromptPresets.is_default, false),
      )).returning({ id: tutorialPromptPresets.id });
      if (!updated.length) return { success: false, error: "Only an Admin can edit shared prompts. Create your own prompt instead." };
    }
    revalidatePath("/tutorial-studio");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

const UpdateSettingsSchema = z.object({
  default_script_provider: z.string().min(1).optional(),
  default_tts_provider: z.string().min(1).optional(),
  default_tts_voice: z.string().optional(),
  default_playback_speed: z.number().min(0.5).max(2.5).optional(),
  record_hotkey: z.string().min(1).optional(),
  retention_hours: z.number().int().min(1).max(720).optional(),
  thumbnail_generation_mode: z.enum(["ai", "manual"]).optional(),
  thumbnail_background_rotation: z.array(z.string().max(120)).max(50).optional(),
  thumbnail_persona_rotation: z.record(z.string(), z.array(z.string().max(300)).max(30)).optional(),
  default_voice_settings: VoiceSettingsSchema.optional(),
});

export async function updateTutorialSettingsAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  // This row is shared across the entire installation, not a VA preference.
  if (!session || !hasPermission(session, "manage:tutorial-settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = UpdateSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const data = parsed.data;
    await updateTutorialSettings(db, {
      ...data,
      default_playback_speed: data.default_playback_speed
        ? String(data.default_playback_speed)
        : undefined,
    });
    revalidatePath("/tutorial-studio");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
