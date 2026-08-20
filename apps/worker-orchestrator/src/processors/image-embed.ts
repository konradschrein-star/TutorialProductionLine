/**
 * Image Embed Processor
 *
 * Computes BGE-M3 dense (halfvec 384) + sparse (jsonb) embeddings for an
 * image and stores them. Same sidecar call as clip-embed, just with the
 * image's text payload. Semantic dedup mirrors clip-embed: cosine < 0.01
 * to an older sibling in the same library → mark duplicate_of_id.
 */
import type { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { images, sourceImages } from "@repo/db";
import { ImageEmbedPayloadSchema } from "@repo/contracts";
import type { ImageEmbedPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { embedText, checkSidecarHealth } from "./sidecar-client.js";

const logger = createContextLogger("image-embed");

export function createImageEmbedProcessor(db: DrizzleClient) {
  return async (job: Job<ImageEmbedPayload>): Promise<void> => {
    const parseResult = ImageEmbedPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid image-embed payload: ${parseResult.error.message}`,
      );
    }
    const { image_id } = parseResult.data;
    logger.info({ image_id, bullmq_job_id: job.id }, "image-embed invoked");

    const [image] = await db
      .select()
      .from(images)
      .where(eq(images.id, image_id))
      .limit(1);
    if (!image) throw new Error(`image not found: ${image_id}`);
    if (image.is_usable === false) {
      logger.info({ image_id }, "image rejected — skipping embedding");
      return;
    }

    const { audioFace } = await checkSidecarHealth();
    if (!audioFace) {
      logger.info({ image_id }, "sidecar unavailable — skipping embedding");
      return;
    }

    // Build text payload identical in spirit to clip-embed.
    const textParts: (string | null | undefined)[] = [
      image.scene_context,
      image.ai_description,
      image.source_episode ? `Source: ${image.source_episode}` : null,
      image.clip_type && image.clip_type !== "unknown"
        ? `Type: ${image.clip_type.replace(/_/g, " ")}`
        : null,
      image.tags_characters.length > 0
        ? `Characters: ${image.tags_characters.join(", ")}`
        : null,
      image.tags_location.length > 0
        ? `Location: ${image.tags_location.join(", ")}`
        : null,
      image.tags_action.length > 0
        ? `Action: ${image.tags_action.join(", ")}`
        : null,
      image.dominant_mood ? `Mood: ${image.dominant_mood}` : null,
      image.tags_mood.length > 0 ? image.tags_mood.join(", ") : null,
      image.shot_scale ? `Shot: ${image.shot_scale.replace(/_/g, " ")}` : null,
      image.lighting_style
        ? `Lighting: ${image.lighting_style.replace(/_/g, " ")}`
        : null,
      image.keywords.length > 0
        ? `Keywords: ${image.keywords.join(", ")}`
        : null,
      image.tags_custom.length > 0 ? image.tags_custom.join(", ") : null,
    ].filter(Boolean);

    const embeddingText = textParts.join(". ");
    if (!embeddingText.trim()) {
      throw new Error(`image has no content to embed: ${image_id}`);
    }

    const result = await embedText(embeddingText);

    const denseStr = `[${result.dense.join(",")}]`;
    await db.execute(sql`
      UPDATE images
      SET embedding = ${denseStr}::halfvec(384), updated_at = NOW()
      WHERE id = ${image_id}
    `);
    await db.execute(sql`
      UPDATE images
      SET embedding_sparse = ${JSON.stringify(result.sparse)}::jsonb, updated_at = NOW()
      WHERE id = ${image_id}
    `);

    logger.info(
      {
        image_id,
        dense_dims: result.dense.length,
        sparse_nnz: result.sparse.indices.length,
      },
      "image embedded",
    );

    // ── Semantic dedup (mirrors clip-embed) ────────────────────────────
    try {
      const DEDUP_THRESHOLD = 0.01;
      const dupRows = (await db.execute(sql`
        SELECT id
        FROM images
        WHERE library_id = ${image.library_id}
          AND id <> ${image_id}::uuid
          AND embedding IS NOT NULL
          AND duplicate_of_id IS NULL
          AND created_at < ${image.created_at}
          AND (embedding <=> ${denseStr}::halfvec(384)) < ${DEDUP_THRESHOLD}
        ORDER BY embedding <=> ${denseStr}::halfvec(384)
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;

      if (dupRows.length > 0) {
        const canonicalId = dupRows[0]!.id;
        await db
          .update(images)
          .set({
            duplicate_of_id: canonicalId,
            is_usable: false,
            review_status: "skipped",
            updated_at: new Date(),
          })
          .where(eq(images.id, image_id));
        logger.info(
          { image_id, duplicate_of: canonicalId },
          "image flagged as semantic duplicate",
        );
      }
    } catch (err) {
      logger.warn(
        { image_id, error: err instanceof Error ? err.message : String(err) },
        "image dedup check failed — skipping",
      );
    }

    // Roll up source_image to ready.
    await db
      .update(sourceImages)
      .set({ ingest_status: "ready", updated_at: new Date() })
      .where(eq(sourceImages.id, image.source_image_id));
  };
}
