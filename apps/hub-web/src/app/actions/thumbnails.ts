"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  createArchetype,
  updateArchetype,
  upsertChannelProfile,
  setChannelArchetypes,
} from "@/lib/repositories/thumbnail-studio-repository";
import type {
  NewThumbnailArchetype,
  NewChannelThumbnailProfile,
} from "@repo/db";

type ActionResult = { success: boolean; error?: string };

// ── Archetypes ───────────────────────────────────────────────────────────────

const SaveArchetypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  reference_image_path: z.string().min(1),
  layout_instructions: z.string().optional(),
  base_prompt: z.string().optional(),
  features_logo: z.boolean().optional().default(false),
  category: z.string().optional(),
  formats: z.array(z.string()).default([]),
});

export async function saveArchetype(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = SaveArchetypeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const { id, ...data } = parsed.data;
    if (id) {
      const updated = await updateArchetype(id, data);
      if (!updated) {
        return { success: false, error: "Archetype not found" };
      }
    } else {
      await createArchetype(data as NewThumbnailArchetype);
    }
    revalidatePath("/thumbnails");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Channel persona — REMOVED (migration 0061) ───────────────────────────────
//
// `channel_personas` is a read-only VIEW over the character library now. A
// channel's host is a CHARACTER with MANY images (that is what makes thumbnail
// cycling possible), managed at /characters. The old action wrote a second,
// silently divergable copy of the same concept, and its UI advertised
// "reusable for intros & mascots" — nothing ever consumed it for either.
//
// The export is kept as an explicit failure so any caller that survived the
// sweep says what to do instead of dying on "cannot insert into view".
export async function saveChannelPersona(): Promise<ActionResult> {
  return {
    success: false,
    error:
      "Channel personas moved to the Character Library (/characters). A host " +
      "is a character with many images, not a single image_path.",
  };
}

// ── Channel branding ─────────────────────────────────────────────────────────

const SaveChannelBrandingSchema = z.object({
  channel_id: z.string().uuid(),
  logo_image_path: z.string().optional(),
  primary_color: z.string().max(16).optional(),
  secondary_color: z.string().max(16).optional(),
  default_prompt_mode: z.enum(["programmatic", "deepseek"]).optional(),
  extra_prompt_notes: z.string().optional(),
});

export async function saveChannelBranding(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = SaveChannelBrandingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    await upsertChannelProfile(parsed.data as NewChannelThumbnailProfile);
    revalidatePath("/thumbnails");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Channel <-> archetype links ──────────────────────────────────────────────

const SaveChannelArchetypesSchema = z.object({
  channelId: z.string().uuid(),
  archetypeIds: z.array(z.string().uuid()),
});

export async function saveChannelArchetypes(
  channelId: string,
  archetypeIds: string[],
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = SaveChannelArchetypesSchema.safeParse({
    channelId,
    archetypeIds,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    await setChannelArchetypes(parsed.data.channelId, parsed.data.archetypeIds);
    revalidatePath("/thumbnails");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
