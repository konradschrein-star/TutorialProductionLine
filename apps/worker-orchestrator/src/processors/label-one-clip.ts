/**
 * Per-clip labeling pipeline — extracted from clip-label.ts so the
 * clip-label-batch worker can run the same logic on every clip of a
 * source_video in sequence, threading prev_context forward.
 *
 * Steps:
 *   2. VLM (Gemini) — populates ai_description, scene_context, tags, etc.
 *   3. Whisper transcription — populates transcript + transcript_json
 *   4. Face recognition — populates characters_present + character_registry centroids
 *   5. Audio classification — populates audio_class
 *   6. Dispatch embed job + mark clip done + roll up source_video status
 *
 * State machine (labeling_step = LAST COMPLETED step):
 *   null → vlm → whisper → face → audio → done
 *
 * The helper is idempotent: it resumes from labeling_step on retry without
 * repeating work.
 */
import type { Queue } from "bullmq";
import { and, count, eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import {
  clips,
  sourceVideos,
  type clipLibraries,
  clipLabelHistory,
} from "@repo/db";
import { TranscriptSchema } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import {
  transcribeClip,
  recognizeFaces,
  classifyAudio,
} from "./sidecar-client.js";
import { labelClipWithGemini } from "../utils/gemini-vision.js";
import { getLibraryLabelLimiter } from "../utils/simple-concurrency-limiter.js";

const logger = createContextLogger("label-one-clip");

// Minimal row shapes — keep loose to avoid coupling to the full Drizzle types.
type ClipRow = typeof clips.$inferSelect;
type SourceVideoRow = typeof sourceVideos.$inferSelect;
type LibraryRow = typeof clipLibraries.$inferSelect;

export interface LabelOneClipParams {
  db: DrizzleClient;
  queues: { clipEmbed: Queue };
  clip: ClipRow;
  sourceVideo: SourceVideoRow;
  library: LibraryRow;
  videoPath: string;
  /** Previous clip's scene_context, injected into Gemini's library_context. */
  prevSceneContext?: string | null;
}

export interface LabelOneClipResult {
  /** scene_context Gemini wrote for this clip — chain forward in batch mode. */
  sceneContext: string | null;
  /** True if Gemini rejected the clip — caller can short-circuit context flow. */
  rejected: boolean;
}

/**
 * Run the 4-step labeling pipeline for a single clip. Idempotent; resumes
 * from clip.labeling_step. Returns the scene_context to thread to the next
 * clip in batch mode.
 */
export async function labelOneClip(
  params: LabelOneClipParams,
): Promise<LabelOneClipResult> {
  const {
    db,
    queues,
    clip,
    sourceVideo,
    library,
    videoPath,
    prevSceneContext,
  } = params;
  const clip_id = clip.id;
  const library_id = library.id;

  const tagVocabulary = library.tag_vocabulary as Record<string, string[]>;
  let labelingStep = clip.labeling_step;
  let wasRejected = false;
  let sceneContext: string | null = clip.scene_context ?? null;

  if (labelingStep === "done") {
    return { sceneContext, rejected: clip.is_usable === false };
  }

  // ── Step 2: VLM (Gemini) ────────────────────────────────────────────────
  if (labelingStep === null) {
    logger.info({ clip_id }, "Starting VLM step");

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
          // library_context is the persistent vibe ("Library: Harry Potter");
          // prev_clip_context is the moment-to-moment temporal anchor.
          library_context: library.name
            ? `Library: ${library.name}`
            : undefined,
          prev_clip_context: prevSceneContext?.trim() || undefined,
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
          shot_scale: labels.shot_scale as never,
          dominant_mood: labels.dominant_mood,
          motion_level: labels.motion_level,
          camera_movement: labels.camera_movement,
          lighting_style: labels.lighting_style,
          color_temperature: labels.color_temperature,
          face_count: labels.face_count,
          has_text_overlay: labels.has_text_overlay,
          dialogue_present: labels.dialogue_present,
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
      sceneContext = labels.scene_context || null;
      logger.info({ clip_id }, "VLM step complete");
    } else {
      throw new Error(
        `Gemini vision call failed for clip ${clip_id} — retrying`,
      );
    }
  }

  // ── Step 3: Whisper ─────────────────────────────────────────────────────
  if (labelingStep === "vlm") {
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
          transcript_json: validated as never,
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

  // ── Step 4: Face recognition ───────────────────────────────────────────
  if (labelingStep === "whisper") {
    logger.info({ clip_id }, "Starting face recognition step");

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
    logger.info({ clip_id, characters: recognizedNames }, "Face step complete");
  }

  // ── Step 5: Audio classification ───────────────────────────────────────
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

  // ── Step 6: Dispatch embed + mark done ─────────────────────────────────
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

  // ── Source-video roll-up ───────────────────────────────────────────────
  // Cheap query — only runs once at the end of each labeling pass. The
  // batch processor calls it once after the whole loop, which is even
  // cheaper, but doing it here also keeps the per-clip path correct.
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
      .set({ ingest_status: "ready", updated_at: new Date() })
      .where(eq(sourceVideos.id, clip.source_video_id));
    logger.info(
      { source_video_id: clip.source_video_id },
      "All clips labeled — source_video ready",
    );
  }

  return { sceneContext, rejected: wasRejected };
}
