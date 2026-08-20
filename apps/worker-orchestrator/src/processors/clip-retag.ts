import type { Job, Queue } from "bullmq";
import { eq, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import type { DrizzleClient } from "@repo/db";
import { clips, clipLibraries, clipLabelHistory } from "@repo/db";
import { ClipRetagPayloadSchema } from "@repo/contracts";
import type { ClipRetagPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("clip-retag");

const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
});

/**
 * Clip Retag Processor
 *
 * Assigns vocabulary tags from an existing ai_description using Claude Haiku.
 * Used when vocabulary is added/changed after initial VLM labeling — re-runs
 * the tag assignment step without re-running the GPU VLM pipeline.
 *
 * After updating tags, dispatches the clip to the embed queue so the
 * embedding index reflects the new vocabulary.
 *
 * @param db     - Drizzle client
 * @param queues - { clipEmbed: Queue } for dispatching the re-embed step
 */
export function createClipRetagProcessor(
  db: DrizzleClient,
  queues: { clipEmbed: Queue },
) {
  return async (job: Job<ClipRetagPayload>): Promise<void> => {
    const parseResult = ClipRetagPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid clip-retag payload: ${parseResult.error.message}`,
      );
    }

    const { clip_id, library_id } = parseResult.data;

    logger.info(
      { clip_id, library_id, bullmq_job_id: job.id },
      "clip-retag processor invoked",
    );

    const [clip] = await db
      .select()
      .from(clips)
      .where(and(eq(clips.id, clip_id), eq(clips.library_id, library_id)))
      .limit(1);

    if (!clip) {
      throw new Error(`clip not found: ${clip_id}`);
    }

    if (!clip.ai_description) {
      logger.warn({ clip_id }, "clip has no ai_description — skipping retag");
      return;
    }

    const [library] = await db
      .select({ tag_vocabulary: clipLibraries.tag_vocabulary })
      .from(clipLibraries)
      .where(eq(clipLibraries.id, library_id))
      .limit(1);

    if (!library) {
      throw new Error(`clip_library not found: ${library_id}`);
    }

    const vocab = library.tag_vocabulary as Record<string, string[]>;

    const hasVocab = Object.values(vocab).some((arr) => arr.length > 0);
    if (!hasVocab) {
      logger.warn(
        { clip_id, library_id },
        "library vocabulary is empty — skipping retag",
      );
      return;
    }

    const vocabStr = JSON.stringify(vocab, null, 2);

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are a video clip tagging assistant. Given a description of a video clip and a vocabulary of allowed tags, assign the relevant tags.

Clip description: "${clip.ai_description}"

Tag vocabulary (ONLY use values from these lists):
${vocabStr}

Respond with ONLY a JSON object with these keys. Use only values that appear in the vocabulary:
{
  "tags_characters": ["..."],
  "tags_mood": ["..."],
  "tags_location": ["..."],
  "tags_action": ["..."],
  "tags_custom": ["..."]
}

If no tags in a category apply, use an empty array. Do not invent tags not in the vocabulary.`,
        },
      ],
    });

    const rawText =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    let parsed: Record<string, string[]>;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      throw new Error(
        `Failed to parse Claude retag response: ${err}. Raw: ${rawText}`,
      );
    }

    function filterVocab(tags: unknown, category: string): string[] {
      if (!Array.isArray(tags)) return [];
      const allowed = new Set(
        (vocab[category] ?? []).map((v) => v.toLowerCase()),
      );
      return (tags as string[]).filter(
        (t) => typeof t === "string" && allowed.has(t.toLowerCase()),
      );
    }

    const tagsCharacters = filterVocab(parsed["tags_characters"], "characters");
    const tagsMood = filterVocab(parsed["tags_mood"], "mood");
    const tagsLocation = filterVocab(parsed["tags_location"], "location");
    const tagsAction = filterVocab(parsed["tags_action"], "action");
    const tagsCustom = filterVocab(parsed["tags_custom"], "custom");

    const before = {
      tags_characters: clip.tags_characters,
      tags_mood: clip.tags_mood,
      tags_location: clip.tags_location,
      tags_action: clip.tags_action,
      tags_custom: clip.tags_custom,
    };

    await db
      .update(clips)
      .set({
        tags_characters: tagsCharacters,
        tags_mood: tagsMood,
        tags_location: tagsLocation,
        tags_action: tagsAction,
        tags_custom: tagsCustom,
        updated_at: new Date(),
      })
      .where(eq(clips.id, clip_id));

    await db.insert(clipLabelHistory).values({
      clip_id,
      changed_by: "ai-retag",
      before,
      after: {
        tags_characters: tagsCharacters,
        tags_mood: tagsMood,
        tags_location: tagsLocation,
        tags_action: tagsAction,
        tags_custom: tagsCustom,
      },
      change_reason: "vocabulary_retag",
    });

    await queues.clipEmbed.add(
      "embed-clip",
      { clip_id },
      { jobId: `clip-embed-${clip_id}`, removeOnComplete: true },
    );

    logger.info(
      {
        clip_id,
        tags_characters: tagsCharacters,
        tags_mood: tagsMood,
        tags_location: tagsLocation,
        tags_action: tagsAction,
      },
      "clip retag complete, embed dispatched",
    );
  };
}
