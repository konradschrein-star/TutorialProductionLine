import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clips, clipLibraries, clipLabelHistory } from "@repo/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PatchClipSchema = z.object({
  review_status: z
    .enum(["pending", "approved", "edited", "flagged", "skipped"])
    .optional(),
  tags_characters: z.array(z.string()).optional(),
  tags_mood: z.array(z.string()).optional(),
  tags_location: z.array(z.string()).optional(),
  tags_action: z.array(z.string()).optional(),
  tags_custom: z.array(z.string()).optional(),
  ai_description: z.string().optional(),
  shot_scale: z
    .enum([
      "extreme_close",
      "close",
      "medium",
      "wide",
      "extreme_wide",
      "over_shoulder",
      "pov",
      "aerial",
      "unknown",
    ])
    .nullable()
    .optional(),
  clip_type: z
    .enum([
      "text_on_screen",
      "footage_movie",
      "footage_clone_wars",
      "footage_animation",
      "footage_comic",
      "ai_generated",
      "unknown",
    ])
    .optional(),
  dominant_mood: z.string().max(60).nullable().optional(),
  audio_class: z
    .enum([
      "dialogue",
      "music_only",
      "speech_over_music",
      "action_sfx",
      "ambient",
      "silence",
    ])
    .nullable()
    .optional(),
  // Visual analysis (human-correctable)
  motion_level: z
    .enum(["static", "slow", "medium", "fast", "chaotic"])
    .nullable()
    .optional(),
  camera_movement: z
    .enum(["static", "pan", "tilt", "zoom", "dolly", "handheld", "crane"])
    .nullable()
    .optional(),
  lighting_style: z
    .enum(["bright", "dark", "moody", "high_key", "low_key", "silhouette"])
    .nullable()
    .optional(),
  color_temperature: z
    .enum(["warm", "cool", "neutral", "high_contrast", "desaturated"])
    .nullable()
    .optional(),
  has_text_overlay: z.boolean().nullable().optional(),
  dialogue_present: z.boolean().nullable().optional(),
  source_episode: z.string().max(120).nullable().optional(),
  scene_context: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  // Human review
  quality_score: z.number().int().min(1).max(5).nullable().optional(),
  manual_notes: z.string().nullable().optional(),
  is_usable: z.boolean().nullable().optional(),
});

/**
 * PATCH /api/clip-library/clips/[clipId]
 *
 * Update clip review_status and/or tags.
 * Validates tags against the library's tag_vocabulary.
 * Appends an entry to clip_label_history.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clipId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { clipId } = await params;
  if (!clipId || !/^[0-9a-f-]{36}$/i.test(clipId)) {
    return NextResponse.json({ error: "Invalid clip ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const parseResult = PatchClipSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.errors },
      { status: 400 },
    );
  }

  const patch = parseResult.data;

  // Fetch current clip
  const [clip] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);

  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  // If tags are being updated, validate against library vocabulary
  const tagGroupsToValidate: Array<{
    key: keyof typeof patch;
    vocab_key: string;
    values?: string[];
  }> = [
    {
      key: "tags_characters",
      vocab_key: "characters",
      values: patch.tags_characters,
    },
    { key: "tags_mood", vocab_key: "mood", values: patch.tags_mood },
    {
      key: "tags_location",
      vocab_key: "location",
      values: patch.tags_location,
    },
    { key: "tags_action", vocab_key: "action", values: patch.tags_action },
  ];

  const hasTagUpdates = tagGroupsToValidate.some((g) => g.values !== undefined);

  if (hasTagUpdates) {
    const [library] = await db
      .select({ tag_vocabulary: clipLibraries.tag_vocabulary })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, clip.library_id))
      .limit(1);

    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 });
    }

    const vocab = library.tag_vocabulary as Record<string, string[]>;

    for (const group of tagGroupsToValidate) {
      if (group.values === undefined) continue;
      const allowed = vocab[group.vocab_key] ?? [];
      const invalid = group.values.filter((v) => !allowed.includes(v));
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error: `Invalid ${group.vocab_key} tags: ${invalid.join(", ")}. Allowed: ${allowed.join(", ")}`,
          },
          { status: 400 },
        );
      }
    }
  }

  // Build update object
  const updateValues: Partial<typeof clips.$inferInsert> = {};
  if (patch.review_status !== undefined) {
    updateValues.review_status = patch.review_status;
    if (
      patch.review_status === "approved" ||
      patch.review_status === "edited"
    ) {
      updateValues.reviewed_at = new Date();
      updateValues.reviewed_by = session.userId as string;
    }
  }
  if (patch.tags_characters !== undefined)
    updateValues.tags_characters = patch.tags_characters;
  if (patch.tags_mood !== undefined) updateValues.tags_mood = patch.tags_mood;
  if (patch.tags_location !== undefined)
    updateValues.tags_location = patch.tags_location;
  if (patch.tags_action !== undefined)
    updateValues.tags_action = patch.tags_action;
  if (patch.tags_custom !== undefined)
    updateValues.tags_custom = patch.tags_custom;
  if (patch.ai_description !== undefined)
    updateValues.ai_description = patch.ai_description;
  if (patch.shot_scale !== undefined)
    updateValues.shot_scale = patch.shot_scale ?? undefined;
  if (patch.clip_type !== undefined) updateValues.clip_type = patch.clip_type;
  if (patch.dominant_mood !== undefined)
    updateValues.dominant_mood = patch.dominant_mood ?? undefined;
  if (patch.audio_class !== undefined)
    updateValues.audio_class = patch.audio_class ?? undefined;
  if (patch.motion_level !== undefined)
    updateValues.motion_level = patch.motion_level ?? undefined;
  if (patch.camera_movement !== undefined)
    updateValues.camera_movement = patch.camera_movement ?? undefined;
  if (patch.lighting_style !== undefined)
    updateValues.lighting_style = patch.lighting_style ?? undefined;
  if (patch.color_temperature !== undefined)
    updateValues.color_temperature = patch.color_temperature ?? undefined;
  if (patch.has_text_overlay !== undefined)
    updateValues.has_text_overlay = patch.has_text_overlay ?? undefined;
  if (patch.dialogue_present !== undefined)
    updateValues.dialogue_present = patch.dialogue_present ?? undefined;
  if (patch.source_episode !== undefined)
    updateValues.source_episode = patch.source_episode ?? undefined;
  if (patch.scene_context !== undefined)
    updateValues.scene_context = patch.scene_context ?? undefined;
  if (patch.keywords !== undefined) updateValues.keywords = patch.keywords;
  if (patch.quality_score !== undefined)
    updateValues.quality_score = patch.quality_score ?? undefined;
  if (patch.manual_notes !== undefined)
    updateValues.manual_notes = patch.manual_notes ?? undefined;
  if (patch.is_usable !== undefined)
    updateValues.is_usable = patch.is_usable ?? undefined;

  try {
    const [updatedClip] = await db
      .update(clips)
      .set(updateValues)
      .where(eq(clips.id, clipId))
      .returning();

    // Append audit log entry
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(updateValues)) {
      before[k] = (clip as Record<string, unknown>)[k];
      after[k] = v;
    }

    await db.insert(clipLabelHistory).values({
      clip_id: clipId,
      changed_by: `human:${session.userId}`,
      before,
      after,
      change_reason: "HITL review",
    });

    return NextResponse.json({ clip: updatedClip });
  } catch (err) {
    console.error("PATCH /api/clip-library/clips/[clipId] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
