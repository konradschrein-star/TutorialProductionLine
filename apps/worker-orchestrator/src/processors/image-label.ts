/**
 * Image Label Processor
 *
 * Two-step: Gemini single-frame VLM → face recognition. No Whisper, no
 * audio classification — images have neither.
 *
 * State machine (reuses clip_labeling_step enum):
 *   null   → vlm    → face   → done
 *
 * On done, dispatches image-embed and marks the image approved
 * (auto-approve matches the clip-label behaviour; HITL review may
 * downgrade later).
 */
import type { Job, Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import {
  images,
  sourceImages,
  clipLibraries,
  clipLabelHistory,
} from "@repo/db";
import { ImageLabelPayloadSchema } from "@repo/contracts";
import type { ImageLabelPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { recognizeFaces, checkSidecarHealth } from "./sidecar-client.js";
import {
  isGeminiVisionAvailable,
  labelImageWithGemini,
} from "../utils/gemini-vision.js";
import { getLibraryLabelLimiter } from "../utils/simple-concurrency-limiter.js";
import { resolveStoragePath } from "../utils/storage-resolver.js";

const logger = createContextLogger("image-label");

export function createImageLabelProcessor(
  db: DrizzleClient,
  queues: { imageEmbed: Queue },
) {
  return async (job: Job<ImageLabelPayload>): Promise<void> => {
    const parseResult = ImageLabelPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid image-label payload: ${parseResult.error.message}`,
      );
    }
    const { image_id, library_id } = parseResult.data;
    logger.info(
      { image_id, library_id, bullmq_job_id: job.id },
      "image-label invoked",
    );

    const [image] = await db
      .select()
      .from(images)
      .where(eq(images.id, image_id))
      .limit(1);
    if (!image) throw new Error(`image not found: ${image_id}`);
    if (image.labeling_step === "done") {
      logger.info({ image_id }, "image already labeled, skipping");
      return;
    }

    // Health checks once.
    const [{ audioFace }, geminiOk] = await Promise.all([
      checkSidecarHealth(),
      isGeminiVisionAvailable(),
    ]);
    void audioFace;
    if (!geminiOk) {
      throw new Error(`Gemini pool unavailable for image ${image_id} — retry`);
    }

    const [sourceImage] = await db
      .select()
      .from(sourceImages)
      .where(eq(sourceImages.id, image.source_image_id))
      .limit(1);
    if (!sourceImage) throw new Error(`source_image not found`);
    if (!sourceImage.storage_key) {
      throw new Error(`source_image has no storage_key: ${sourceImage.id}`);
    }

    const [library] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, library_id))
      .limit(1);
    if (!library) throw new Error(`clip_library not found: ${library_id}`);

    const imagePath = resolveStoragePath(library, sourceImage.storage_key);
    const tagVocabulary = library.tag_vocabulary as Record<string, string[]>;

    let labelingStep = image.labeling_step;
    let wasRejected = false;

    // ── Step 1: VLM (Gemini single frame) ──────────────────────────────
    if (labelingStep === null) {
      const limiter = getLibraryLabelLimiter(
        library_id,
        library.labeling_concurrency,
      );

      const result = await limiter.execute(() =>
        labelImageWithGemini({
          image_id,
          image_path: imagePath,
          tag_vocabulary: tagVocabulary,
          source_metadata: {
            source_title: sourceImage.work_title ?? undefined,
            source_franchise: library.name,
            source_type: "image",
            library_context: library.name
              ? `Library: ${library.name}`
              : undefined,
          },
        }),
      );

      if (result?.status === "rejected") {
        logger.info(
          { image_id, reason: result.reason },
          "Gemini rejected image",
        );
        await db
          .update(images)
          .set({
            is_usable: false,
            review_status: "skipped",
            labeling_step: "done",
            manual_notes: `AI rejected: ${result.reason} — ${result.detail}`,
            updated_at: new Date(),
          })
          .where(eq(images.id, image_id));
        await db.insert(clipLabelHistory).values({
          clip_id: image_id, // history table FK targets clips; reuse for image events
          changed_by: "ai",
          before: {},
          after: { rejected: true, reason: result.reason, kind: "image" },
          change_reason: "gemini_rejection",
        });
        wasRejected = true;
        labelingStep = "face";
      } else if (result?.status === "labeled") {
        const labels = result.labels;
        await db
          .update(images)
          .set({
            ai_description: labels.description,
            shot_scale: labels.shot_scale as never,
            dominant_mood: labels.dominant_mood,
            lighting_style: labels.lighting_style,
            color_temperature: labels.color_temperature,
            face_count: labels.face_count,
            has_text_overlay: labels.has_text_overlay,
            clip_type: labels.clip_type as never,
            source_episode: labels.source_episode || null,
            scene_context: labels.scene_context || null,
            tags_characters: labels.tags_characters,
            tags_mood: labels.tags_mood,
            tags_location: labels.tags_location,
            tags_action: labels.tags_action,
            tags_custom: labels.tags_custom,
            keywords: labels.keywords,
            ai_confidence: labels.confidence,
            labeling_step: "vlm",
            updated_at: new Date(),
          })
          .where(eq(images.id, image_id));
        labelingStep = "vlm";
      } else {
        throw new Error(`Gemini vision call failed for image ${image_id}`);
      }
    }

    // ── Step 2: Face recognition ───────────────────────────────────────
    // ffmpeg-driven sidecar treats the image file as a 1-frame video, so
    // recognizeFaces with start_ms=0, end_ms=0 works as-is.
    if (labelingStep === "vlm" && !wasRejected) {
      const characters = await db.execute(sql`
        SELECT id, name, face_sample_count, face_centroid::float4[] AS centroid
        FROM character_registry
        WHERE library_id = ${library_id} AND face_sample_count > 0
      `);

      const knownCharacters = (
        characters as unknown as Array<{
          id: string;
          name: string;
          face_sample_count: number;
          centroid: number[] | null;
        }>
      )
        .filter((c) => c.centroid !== null)
        .map((c) => ({ name: c.name, centroid: c.centroid as number[] }));

      let faceResults: Awaited<ReturnType<typeof recognizeFaces>> = [];
      try {
        faceResults = await recognizeFaces({
          clip_id: image_id,
          source_video_path: imagePath,
          start_ms: 0,
          end_ms: 0,
          known_characters: knownCharacters,
        });
      } catch (err) {
        logger.warn(
          { image_id, error: String(err) },
          "Face recognition skipped — sidecar unavailable or image-incompatible",
        );
      }

      const recognized = [
        ...new Set(
          faceResults
            .filter((f) => f.character_name !== null)
            .map((f) => f.character_name as string),
        ),
      ];

      // Centroid maintenance — same algorithm as label-one-clip.
      for (const face of faceResults) {
        if (
          face.character_name &&
          face.embedding &&
          face.embedding.length === 512
        ) {
          const emb = `[${face.embedding.join(",")}]`;
          await db.execute(sql`
            UPDATE character_registry
            SET
              face_centroid = CASE
                WHEN face_sample_count = 0 THEN ${emb}::halfvec(512)
                ELSE (
                  (face_centroid::float4[] * face_sample_count::float4 + ${emb}::halfvec(512)::float4[])
                  / (face_sample_count + 1)::float4
                )::halfvec(512)
              END,
              face_sample_count = LEAST(face_sample_count + 1, 100),
              updated_at = NOW()
            WHERE library_id = ${library_id} AND name = ${face.character_name}
          `);
        }
      }

      await db
        .update(images)
        .set({
          characters_present: recognized,
          labeling_step: "face",
          updated_at: new Date(),
        })
        .where(eq(images.id, image_id));
      labelingStep = "face";
    }

    // ── Step 3: dispatch embed + mark done ─────────────────────────────
    if (labelingStep === "face" && !wasRejected) {
      await queues.imageEmbed.add(
        "embed-image",
        { image_id },
        { jobId: `image-embed-${image_id}`, removeOnComplete: true },
      );
      await db
        .update(images)
        .set({
          labeling_step: "done",
          review_status: "approved",
          updated_at: new Date(),
        })
        .where(eq(images.id, image_id));

      // Roll up source_image status.
      await db
        .update(sourceImages)
        .set({
          ingest_status: "embedding",
          updated_at: new Date(),
        })
        .where(eq(sourceImages.id, image.source_image_id));

      logger.info({ image_id }, "image-label complete, embed dispatched");
    }
  };
}
