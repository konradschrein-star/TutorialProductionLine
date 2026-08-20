import type { Job, Queue } from "bullmq";
import { eq, count, and, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { clips, sourceVideos, clipLibraries, clipLabelHistory } from "@repo/db";
import { ClipLabelPayloadSchema, TranscriptSchema } from "@repo/contracts";
import type { ClipLabelPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import {
  transcribeClip,
  recognizeFaces,
  classifyAudio,
  checkSidecarHealth,
} from "./sidecar-client.js";
import {
  isGeminiVisionAvailable,
  labelClipWithGemini,
} from "../utils/gemini-vision.js";
import { getLibraryLabelLimiter } from "../utils/simple-concurrency-limiter.js";
import { resolveStoragePath } from "../utils/storage-resolver.js";

const logger = createContextLogger("clip-label");

/**
 * Clip Label Processor
 *
 * GPU-serialized (concurrency=1). Processes a single clip through a 4-step
 * labeling pipeline: VLM → Whisper → Face recognition → Audio classification.
 *
 * The `labeling_step` column enables idempotent retry — if the worker crashes
 * mid-way, retrying the BullMQ job resumes from the last completed step.
 *
 * Step state machine (labeling_step value = LAST COMPLETED step):
 *   null     → run all steps
 *   'vlm'    → skip VLM, run whisper → face → audio
 *   'whisper'→ skip VLM + whisper, run face → audio
 *   'face'   → skip to audio only
 *   'audio'  → dispatch embed, mark 'done'
 *   'done'   → return early (already complete)
 *
 * No fallbacks: if any sidecar call fails, the error propagates and BullMQ retries.
 *
 * @param db     - Drizzle client
 * @param queues - { clipEmbed: Queue } for dispatching the embed step
 */
export function createClipLabelProcessor(
  db: DrizzleClient,
  queues: { clipEmbed: Queue },
) {
  return async (job: Job<ClipLabelPayload>): Promise<void> => {
    // Validate payload
    const parseResult = ClipLabelPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      const errorMessage = `Invalid clip-label payload: ${parseResult.error.message}`;
      logger.error(
        { bullmq_job_id: job.id, errors: parseResult.error.errors },
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    const { clip_id, library_id } = parseResult.data;

    logger.info(
      { clip_id, library_id, bullmq_job_id: job.id },
      "clip-label processor invoked",
    );

    // ── Step 1: Load data ──────────────────────────────────────────────────────

    const [clip] = await db
      .select()
      .from(clips)
      .where(eq(clips.id, clip_id))
      .limit(1);

    if (!clip) {
      throw new Error(`clip not found: ${clip_id}`);
    }

    // ── Sidecar + Gemini health check ─────────────────────────────────────────
    // When no labeling backends are available, skip all labeling and mark done
    // so the embed step can proceed without GPU dependencies.

    const [{ audioFace }, geminiAvailable] = await Promise.all([
      checkSidecarHealth(),
      isGeminiVisionAvailable(),
    ]);

    // Gemini is the only VLM backend. No fallback to local model.
    // If the pool is down, throw so BullMQ retries with backoff.
    if (!geminiAvailable) {
      throw new Error(
        `Gemini pool unavailable for clip ${clip_id} — will retry`,
      );
    }

    if (clip.labeling_step === "done") {
      logger.info({ clip_id }, "clip already labeled, skipping");
      return;
    }

    const [sourceVideo] = await db
      .select()
      .from(sourceVideos)
      .where(eq(sourceVideos.id, clip.source_video_id))
      .limit(1);

    if (!sourceVideo) {
      throw new Error(`source_video not found for clip ${clip_id}`);
    }
    if (!sourceVideo.storage_key) {
      throw new Error(`source_video has no storage_key: ${sourceVideo.id}`);
    }

    const [library] = await db
      .select()
      .from(clipLibraries)
      .where(eq(clipLibraries.id, library_id))
      .limit(1);

    if (!library) {
      throw new Error(`clip_library not found: ${library_id}`);
    }

    // Library-aware resolution — supports NAS/S3 backends without touching
    // this processor when those land.
    const videoPath = resolveStoragePath(library, sourceVideo.storage_key);

    const tagVocabulary = library.tag_vocabulary as Record<string, string[]>;

    // Mutable copy — updated in-memory after each completed step so subsequent
    // step guards see the updated value without re-fetching from DB.
    let labelingStep = clip.labeling_step;
    // Set to true if Gemini rejects the clip as junk — skips label steps and
    // prevents step 6 from overwriting review_status = "skipped".
    let wasRejected = false;

    // ── Step 2: VLM (Gemini only) ─────────────────────────────────────────────
    // Gemini is the sole labeling backend. No local model fallback.
    // Unavailability is handled above (throws before reaching here).

    if (labelingStep === null) {
      logger.info({ clip_id }, "Starting VLM step");

      // Per-library soft cap on Gemini concurrency. BullMQ worker concurrency
      // is the global ceiling; this is the per-library throttle. A fragile
      // library can drop labeling_concurrency in the DB without changing
      // the worker config.
      const limiter = getLibraryLabelLimiter(
        library_id,
        library.labeling_concurrency,
      );

      const geminiResult = await limiter.execute(() =>
        labelClipWithGemini({
          clip_id,
          source_video_path: videoPath,
          start_ms: clip.start_ms,
          end_ms: clip.end_ms,
          tag_vocabulary: tagVocabulary,
          source_metadata: {
            source_title: sourceVideo.title ?? undefined,
            source_franchise: library.name,
            source_type: "film",
          },
        }),
      );

      if (geminiResult?.status === "rejected") {
        logger.info(
          { clip_id, reason: geminiResult.reason },
          "Clip rejected by Gemini — marking unusable",
        );

        await db
          .update(clips)
          .set({
            is_usable: false,
            review_status: "skipped",
            labeling_step: "done",
            manual_notes: `AI rejected: ${geminiResult.reason} — ${geminiResult.detail}`,
            updated_at: new Date(),
          })
          .where(eq(clips.id, clip_id));

        await db.insert(clipLabelHistory).values({
          clip_id,
          changed_by: "ai",
          before: {},
          after: { rejected: true, reason: geminiResult.reason },
          change_reason: "gemini_rejection",
        });

        wasRejected = true;
        labelingStep = "audio";
      } else if (geminiResult?.status === "labeled") {
        const labels = geminiResult.labels;
        await db
          .update(clips)
          .set({
            ai_description: labels.description,
            shot_scale: labels.shot_scale as any,
            dominant_mood: labels.dominant_mood,
            motion_level: labels.motion_level,
            camera_movement: labels.camera_movement,
            lighting_style: labels.lighting_style,
            color_temperature: labels.color_temperature,
            face_count: labels.face_count,
            has_text_overlay: labels.has_text_overlay,
            dialogue_present: labels.dialogue_present,
            clip_type: labels.clip_type as any,
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
          .where(eq(clips.id, clip_id));

        await db.insert(clipLabelHistory).values({
          clip_id,
          changed_by: "ai",
          before: {
            ai_description: clip.ai_description,
            shot_scale: clip.shot_scale,
            scene_context: clip.scene_context,
            labeling_step: clip.labeling_step,
          },
          after: {
            ai_description: labels.description,
            shot_scale: labels.shot_scale,
            labeling_step: "vlm",
            source: "gemini",
          },
          change_reason: "vlm_labeling",
        });

        labelingStep = "vlm";
        logger.info({ clip_id }, "VLM step complete");
      } else {
        // null = Gemini pool responded but the vision call itself failed
        throw new Error(
          `Gemini vision call failed for clip ${clip_id} — retrying`,
        );
      }
    }

    // ── Step 3: Whisper ───────────────────────────────────────────────────────
    // Run when labeling_step is null (already advanced to 'vlm' above) or 'vlm'.

    if (labelingStep === null || labelingStep === "vlm") {
      logger.info({ clip_id }, "Starting Whisper step");

      try {
        const transcript = await transcribeClip({
          clip_id,
          source_video_path: videoPath,
          start_ms: clip.start_ms,
          end_ms: clip.end_ms,
        });

        const validated = TranscriptSchema.parse(transcript);
        const transcriptText = validated.words.map((w) => w.word).join(" ");

        await db
          .update(clips)
          .set({
            transcript: transcriptText,
            transcript_json: validated as any,
            labeling_step: "whisper",
            updated_at: new Date(),
          })
          .where(eq(clips.id, clip_id));

        logger.info(
          { clip_id, word_count: validated.words.length },
          "Whisper step complete",
        );
      } catch (whisperErr) {
        logger.warn(
          { clip_id, error: String(whisperErr) },
          "Whisper transcription failed — skipping, continuing with face/audio",
        );
        await db
          .update(clips)
          .set({ labeling_step: "whisper", updated_at: new Date() })
          .where(eq(clips.id, clip_id));
      }

      labelingStep = "whisper";
    }

    // ── Step 4: Face recognition ──────────────────────────────────────────────
    // At this point TypeScript has narrowed labelingStep: by step 2, null→"vlm";
    // by step 3, "vlm"/"null"→"whisper". So entry "whisper" means face not yet run.

    if (labelingStep === "whisper") {
      logger.info({ clip_id }, "Starting face recognition step");

      // Load known characters with their centroids via raw SQL (halfvec type not in Drizzle schema).
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
          clip_id,
          source_video_path: videoPath,
          start_ms: clip.start_ms,
          end_ms: clip.end_ms,
          known_characters: knownCharacters,
        });
      } catch (faceErr) {
        logger.warn(
          { clip_id, error: String(faceErr) },
          "Face recognition skipped (sidecar unavailable)",
        );
      }

      const recognizedNames = [
        ...new Set(
          faceResults
            .filter((f) => f.character_name !== null)
            .map((f) => f.character_name as string),
        ),
      ];

      // Update character centroids using running mean (capped at 100 samples).
      for (const face of faceResults) {
        if (
          face.character_name &&
          face.embedding &&
          face.embedding.length === 512
        ) {
          const embeddingLiteral = `[${face.embedding.join(",")}]`;
          await db.execute(sql`
            UPDATE character_registry
            SET
              face_centroid = CASE
                WHEN face_sample_count = 0 THEN ${embeddingLiteral}::halfvec(512)
                ELSE (
                  (
                    face_centroid::float4[] * face_sample_count::float4
                    + ${embeddingLiteral}::halfvec(512)::float4[]
                  ) / (face_sample_count + 1)::float4
                )::halfvec(512)
              END,
              face_sample_count = LEAST(face_sample_count + 1, 100),
              updated_at = NOW()
            WHERE library_id = ${library_id} AND name = ${face.character_name}
          `);
        }
      }

      await db
        .update(clips)
        .set({
          characters_present: recognizedNames,
          labeling_step: "face",
          updated_at: new Date(),
        })
        .where(eq(clips.id, clip_id));

      labelingStep = "face";
      logger.info(
        { clip_id, characters: recognizedNames },
        "Face step complete",
      );
    }

    // ── Step 5: Audio classification ─────────────────────────────────────────
    // At this point labelingStep is "face" (set by step 4) or entered as "face".

    if (labelingStep === "face") {
      logger.info({ clip_id }, "Starting audio classification step");

      let audioResult: Awaited<ReturnType<typeof classifyAudio>> | null = null;
      try {
        audioResult = await classifyAudio({
          clip_id,
          source_video_path: videoPath,
          start_ms: clip.start_ms,
          end_ms: clip.end_ms,
        });
      } catch (audioErr) {
        logger.warn(
          { clip_id, error: String(audioErr) },
          "Audio classification skipped (sidecar unavailable)",
        );
      }

      await db
        .update(clips)
        .set({
          audio_class: audioResult?.dominant_class ?? "ambient",
          labeling_step: "audio",
          updated_at: new Date(),
        })
        .where(eq(clips.id, clip_id));

      labelingStep = "audio";
      logger.info(
        { clip_id, audio_class: audioResult?.dominant_class },
        "Audio step complete",
      );
    }

    // ── Step 6: Dispatch embed + mark done ────────────────────────────────────
    // Runs whenever we reach this point with labeling_step === 'audio'.
    // This covers both: entering at 'audio' from DB AND having just completed it above.
    // Skip if wasRejected — embed and DB update were already handled in the rejection branch.

    if (labelingStep === "audio" && !wasRejected) {
      await queues.clipEmbed.add(
        "embed-clip",
        { clip_id },
        { jobId: `clip-embed-${clip_id}`, removeOnComplete: true },
      );

      await db
        .update(clips)
        .set({
          labeling_step: "done",
          review_status: "approved",
          updated_at: new Date(),
        })
        .where(eq(clips.id, clip_id));

      logger.info({ clip_id }, "Labeling complete, embed dispatched");
    }

    // ── Check if all clips for this source_video are labeled ─────────────────
    // If so, advance the source_video to 'ready' status.

    const [pendingResult] = await db
      .select({ count: count() })
      .from(clips)
      .where(
        and(
          eq(clips.source_video_id, clip.source_video_id),
          sql`(labeling_step != 'done' OR labeling_step IS NULL)`,
        ),
      );

    if (Number(pendingResult?.count ?? 1) === 0) {
      await db
        .update(sourceVideos)
        .set({
          ingest_status: "ready",
          updated_at: new Date(),
        })
        .where(eq(sourceVideos.id, clip.source_video_id));

      logger.info(
        { source_video_id: clip.source_video_id },
        "All clips labeled — source_video ready",
      );
    }
  };
}
