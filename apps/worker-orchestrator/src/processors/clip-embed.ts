import type { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { clips } from "@repo/db";
import { ClipEmbedPayloadSchema } from "@repo/contracts";
import type { ClipEmbedPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { embedText, checkSidecarHealth } from "./sidecar-client.js";

const logger = createContextLogger("clip-embed");

/**
 * Clip Embed Processor
 *
 * Computes BGE-M3 dense (halfvec 1024-dim) and sparse embeddings for a clip
 * and stores them in the clips table. Called after the clip-label processor
 * has populated ai_description, transcript, shot_scale, dominant_mood, and
 * all tag columns.
 *
 * Dense embedding stored via raw SQL (Drizzle does not support halfvec type).
 * Sparse embedding stored as jsonb { indices: number[], values: number[] }.
 *
 * No queues — embed is a terminal step in the clip ingest pipeline.
 *
 * @param db - Drizzle client
 */
export function createClipEmbedProcessor(db: DrizzleClient) {
  return async (job: Job<ClipEmbedPayload>): Promise<void> => {
    // ── Validate payload ─────────────────────────────────────────────────────
    const parseResult = ClipEmbedPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid clip-embed payload: ${parseResult.error.message}`;
      logger.error(
        { bullmq_job_id: job.id, errors: parseResult.error.errors },
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    const { clip_id } = parseResult.data;

    logger.info(
      { clip_id, bullmq_job_id: job.id },
      "clip-embed processor invoked",
    );

    // ── Load clip ────────────────────────────────────────────────────────────
    const [clip] = await db
      .select()
      .from(clips)
      .where(eq(clips.id, clip_id))
      .limit(1);

    if (!clip) {
      throw new Error(`clip not found: ${clip_id}`);
    }

    // Rejected clips (credits, watermarks, etc.) have no labels to embed.
    if (clip.is_usable === false) {
      logger.info({ clip_id }, "clip rejected — skipping embedding");
      return;
    }

    // ── Check audio-face sidecar availability (BGE-M3 runs there) ───────────
    const { audioFace } = await checkSidecarHealth();
    if (!audioFace) {
      logger.info(
        { clip_id },
        `Audio-face sidecar unavailable — skipping embedding for clip ${clip_id}`,
      );
      return;
    }

    // ── Build embedding text ─────────────────────────────────────────────────
    // Order matters for BGE-M3: most semantically meaningful content first.
    // scene_context is the Gemini-generated narrative description ("Palpatine
    // reveals himself as Darth Sidious and fights Mace Windu in the Senate") —
    // this single field produces the biggest search quality uplift.
    const textParts: (string | null | undefined)[] = [
      // 1. Narrative context — what's happening in story terms (Gemini-generated)
      clip.scene_context,

      // 2. Visual description of the frame
      clip.ai_description,

      // 3. Transcript — spoken dialogue is gold for scene matching
      clip.transcript,

      // 4. Source identification
      clip.source_episode ? `Source: ${clip.source_episode}` : null,
      clip.clip_type && clip.clip_type !== "unknown"
        ? `Type: ${clip.clip_type.replace(/_/g, " ")}`
        : null,

      // 5. Named characters
      clip.tags_characters.length > 0
        ? `Characters: ${clip.tags_characters.join(", ")}`
        : null,

      // 6. Location and action
      clip.tags_location.length > 0
        ? `Location: ${clip.tags_location.join(", ")}`
        : null,
      clip.tags_action.length > 0
        ? `Action: ${clip.tags_action.join(", ")}`
        : null,

      // 7. Mood and atmosphere
      clip.dominant_mood ? `Mood: ${clip.dominant_mood}` : null,
      clip.tags_mood.length > 0 ? clip.tags_mood.join(", ") : null,

      // 8. Visual style
      clip.shot_scale ? `Shot: ${clip.shot_scale.replace(/_/g, " ")}` : null,
      clip.lighting_style
        ? `Lighting: ${clip.lighting_style.replace(/_/g, " ")}`
        : null,

      // 9. Free-form keywords and custom tags
      clip.keywords.length > 0 ? `Keywords: ${clip.keywords.join(", ")}` : null,
      clip.tags_custom.length > 0 ? clip.tags_custom.join(", ") : null,
    ].filter(Boolean);

    const embeddingText = textParts.join(". ");

    if (!embeddingText.trim()) {
      throw new Error(`clip has no content to embed: ${clip_id}`);
    }

    logger.info(
      { clip_id, text_length: embeddingText.length },
      "Calling sidecar for embedding",
    );

    // ── Call sidecar ─────────────────────────────────────────────────────────
    const result = await embedText(embeddingText);

    // ── Store dense embedding (halfvec via raw SQL) ──────────────────────────
    const denseStr = `[${result.dense.join(",")}]`;
    await db.execute(sql`
      UPDATE clips
      SET embedding = ${denseStr}::halfvec(384), updated_at = NOW()
      WHERE id = ${clip_id}
    `);

    // ── Store sparse embedding (jsonb) ───────────────────────────────────────
    await db.execute(sql`
      UPDATE clips
      SET embedding_sparse = ${JSON.stringify(result.sparse)}::jsonb, updated_at = NOW()
      WHERE id = ${clip_id}
    `);

    logger.info(
      {
        clip_id,
        dense_dims: result.dense.length,
        sparse_nnz: result.sparse.indices.length,
      },
      "Clip embedded",
    );

    // ── Semantic dedup ───────────────────────────────────────────────────────
    // After writing the embedding, look for an older sibling within the same
    // library whose vector is effectively identical (cosine distance < 0.01).
    // Same Pexels fire animation pulled from two different ingest paths, the
    // same scene re-encoded at a different bitrate, etc. Mark this clip as a
    // duplicate; selection skips clips with duplicate_of_id != NULL.
    try {
      const DEDUP_THRESHOLD = 0.01;
      const dupRows = (await db.execute(sql`
        SELECT id
        FROM clips
        WHERE library_id = ${clip.library_id}
          AND id <> ${clip_id}::uuid
          AND embedding IS NOT NULL
          AND duplicate_of_id IS NULL
          AND created_at < ${clip.created_at}
          AND (embedding <=> ${denseStr}::halfvec(384)) < ${DEDUP_THRESHOLD}
        ORDER BY embedding <=> ${denseStr}::halfvec(384)
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;

      if (dupRows.length > 0) {
        const canonicalId = dupRows[0]!.id;
        await db
          .update(clips)
          .set({
            duplicate_of_id: canonicalId,
            is_usable: false,
            review_status: "skipped",
            updated_at: new Date(),
          })
          .where(eq(clips.id, clip_id));
        logger.info(
          { clip_id, duplicate_of: canonicalId },
          "Clip flagged as semantic duplicate",
        );
      }
    } catch (err) {
      // Dedup is opportunistic — failure here must not fail the whole job.
      logger.warn(
        { clip_id, error: err instanceof Error ? err.message : String(err) },
        "Semantic dedup check failed — skipping",
      );
    }
  };
}
