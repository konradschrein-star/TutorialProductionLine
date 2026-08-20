import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "../constants/queue-names.js";
import { getQueueOptions } from "../options/queue-options.js";
import type {
  IngestPayload,
  AIGenerationPayload,
  QMSValidationPayload,
  RenderHeavyPayload,
  GarbageCollectionPayload,
  SceneAnalysisPayload,
  BundestagClipAnalysisPayload,
  BundestagPlaybookGenerationPayload,
  BundestagRenderPayload,
  VideoStitchPayload,
  ClipIngestPayload,
  ClipLabelPayload,
  ClipLabelBatchPayload,
  ClipEmbedPayload,
  ImageIngestPayload,
  ImageLabelPayload,
  ImageEmbedPayload,
  ClipSelectionPayload,
  ClipRetagPayload,
  ClipExtractPayload,
  DramaTTSPayload,
  DramaTranscribePayload,
  DramaPromptGenPayload,
  DramaImageGenPayload,
  DramaVideoGenPayload,
  DramaAssemblePayload,
  DramaQCPayload,
  DramaThumbnailPayload,
  ThumbnailPayload,
  StockLibraryGenPayload,
  TutorialGeneratePayload,
  TutorialSplicePayload,
  TutorialStitchPayload,
  ReactorDownloadPayload,
  ReactorTranscribePayload,
  ReactorScriptPayload,
  ReactorTTSPayload,
  ReactorAssemblePayload,
  ClipForgeIngestPayload,
  ClipForgeClipDetectionPayload,
  ClipForgeRawRenderPayload,
  ClipForgeFinishingRenderPayload,
  TechFootageCollectionPayload,
} from "@repo/contracts";

/**
 * Typed Queue Factories
 *
 * Factory functions that create typed Queue<PayloadType> instances.
 * Each factory enforces the correct payload type via TypeScript.
 *
 * Design:
 * - Type safety: queue.add() is type-checked against the payload schema
 * - No singletons: apps manage queue lifecycle
 * - Default options: sensible defaults per workload profile (can be overridden)
 */

/**
 * Create Ingest Queue
 *
 * Queue for initial job creation and workflow setup.
 *
 * @param connection - IORedis connection (from createRedisConnection)
 * @returns Typed Queue<IngestPayload>
 */
export function createIngestQueue(connection: Redis): Queue<IngestPayload> {
  return new Queue<IngestPayload>(QUEUE_NAMES.INGEST, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.INGEST),
  });
}

/**
 * Create AI Generation Queue
 *
 * Queue for TTS, LLM API calls, and external AI services.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<AIGenerationPayload>
 */
export function createAIGenerationQueue(
  connection: Redis,
): Queue<AIGenerationPayload> {
  return new Queue<AIGenerationPayload>(QUEUE_NAMES.AI_GENERATION, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.AI_GENERATION),
  });
}

/**
 * Create Asset Collection Queue
 *
 * Queue for asset collection pipeline coordination.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<{ job_id: string }>
 */
export function createAssetCollectionQueue(
  connection: Redis,
): Queue<{ job_id: string }> {
  return new Queue<{ job_id: string }>(QUEUE_NAMES.ASSET_COLLECTION, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.ASSET_COLLECTION),
  });
}

/**
 * Create QMS Validation Queue
 *
 * Queue for lightweight pre-flight checks before expensive operations.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<QMSValidationPayload>
 */
export function createQMSValidationQueue(
  connection: Redis,
): Queue<QMSValidationPayload> {
  return new Queue<QMSValidationPayload>(QUEUE_NAMES.QMS_VALIDATION, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.QMS_VALIDATION),
  });
}

/**
 * Create Render Heavy Queue
 *
 * Queue for FFmpeg/Remotion CPU-bound rendering.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<RenderHeavyPayload>
 */
export function createRenderHeavyQueue(
  connection: Redis,
): Queue<RenderHeavyPayload> {
  return new Queue<RenderHeavyPayload>(QUEUE_NAMES.RENDER_HEAVY, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.RENDER_HEAVY),
  });
}

/**
 * Create Garbage Collection Queue
 *
 * Queue for R2 asset deletion and zombie cleanup.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<GarbageCollectionPayload>
 */
export function createGarbageCollectionQueue(
  connection: Redis,
): Queue<GarbageCollectionPayload> {
  return new Queue<GarbageCollectionPayload>(QUEUE_NAMES.GARBAGE_COLLECTION, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.GARBAGE_COLLECTION),
  });
}

/**
 * Create Scene Analysis Queue
 *
 * Queue for LLM-based script decomposition into structured scenes.
 * Populates assembly_manifest in content_jobs.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<SceneAnalysisPayload>
 */
export function createSceneAnalysisQueue(
  connection: Redis,
): Queue<SceneAnalysisPayload> {
  return new Queue<SceneAnalysisPayload>(QUEUE_NAMES.SCENE_ANALYSIS, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.SCENE_ANALYSIS),
  });
}

/**
 * Create Auto-Label Queue
 *
 * Queue for automatic tag generation for a published content job.
 * Reads the job script/title, calls local Ollama LLM, writes back to
 * content_jobs.generated_tags. Low priority, low concurrency.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<{ job_id: string }>
 */
export function createAutoLabelQueue(
  connection: Redis,
): Queue<{ job_id: string }> {
  return new Queue<{ job_id: string }>(QUEUE_NAMES.AUTO_LABEL, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.AUTO_LABEL),
  });
}

/**
 * Create Dead Letter Queue
 *
 * Queue for irrecoverable failures requiring manual inspection.
 * No payload type - accepts any failed job.
 *
 * @param connection - IORedis connection
 * @returns Queue for dead letter jobs
 */
export function createDeadLetterQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAMES.DEAD_LETTER, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DEAD_LETTER),
  });
}

/**
 * Create Bundestag Clip Analysis Queue
 *
 * Queue for transcription and analysis of parliamentary debate clips.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<BundestagClipAnalysisPayload>
 */
export function createBundestagClipAnalysisQueue(
  connection: Redis,
): Queue<BundestagClipAnalysisPayload> {
  return new Queue<BundestagClipAnalysisPayload>(
    QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS,
    {
      connection,
      ...getQueueOptions(QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS),
    },
  );
}

/**
 * Create Bundestag Playbook Generation Queue
 *
 * Queue for LLM-based editing playbook generation from analyzed clips.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<BundestagPlaybookGenerationPayload>
 */
export function createBundestagPlaybookGenerationQueue(
  connection: Redis,
): Queue<BundestagPlaybookGenerationPayload> {
  return new Queue<BundestagPlaybookGenerationPayload>(
    QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION,
    {
      connection,
      ...getQueueOptions(QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION),
    },
  );
}

/**
 * Create Bundestag Render Queue
 *
 * Queue for FFmpeg-based video composition using playbook.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<BundestagRenderPayload>
 */
export function createBundestagRenderQueue(
  connection: Redis,
): Queue<BundestagRenderPayload> {
  return new Queue<BundestagRenderPayload>(QUEUE_NAMES.BUNDESTAG_RENDER, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.BUNDESTAG_RENDER),
  });
}

/**
 * Create Video Stitch Queue
 *
 * Queue for stitching multiple VA tutorial recordings into single videos.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<VideoStitchPayload>
 */
export function createVideoStitchQueue(
  connection: Redis,
): Queue<VideoStitchPayload> {
  return new Queue<VideoStitchPayload>(QUEUE_NAMES.VIDEO_STITCH, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.VIDEO_STITCH),
  });
}

/**
 * Create Clip Ingest Queue
 *
 * Queue for downloading source video and running scene detection.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipIngestPayload>
 */
export function createClipIngestQueue(
  connection: Redis,
): Queue<ClipIngestPayload> {
  return new Queue<ClipIngestPayload>(QUEUE_NAMES.CLIP_INGEST, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_INGEST),
  });
}

/**
 * Create Clip Label Queue
 *
 * GPU-serialized queue for VLM + Whisper large-v3 + face + audio analysis.
 * Concurrency is fixed at 1 in worker options — GPU is the bottleneck.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipLabelPayload>
 */
export function createClipLabelQueue(
  connection: Redis,
): Queue<ClipLabelPayload> {
  return new Queue<ClipLabelPayload>(QUEUE_NAMES.CLIP_LABEL, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_LABEL),
  });
}

/**
 * Create Clip Label Batch Queue
 *
 * Coarse-grained queue for context-aware labeling. One job per source video;
 * the processor loads every clip for that source in clip_index order and
 * sends them to Gemini sequentially with the previous clip's scene_context
 * injected into the prompt. Solves micro-clip hallucination when the 3s
 * minimum is removed.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipLabelBatchPayload>
 */
export function createClipLabelBatchQueue(
  connection: Redis,
): Queue<ClipLabelBatchPayload> {
  return new Queue<ClipLabelBatchPayload>(QUEUE_NAMES.CLIP_LABEL_BATCH, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_LABEL_BATCH),
  });
}

/**
 * Create Clip Embed Queue
 *
 * Queue for BGE-M3 dense + sparse embedding of clip metadata.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipEmbedPayload>
 */
export function createClipEmbedQueue(
  connection: Redis,
): Queue<ClipEmbedPayload> {
  return new Queue<ClipEmbedPayload>(QUEUE_NAMES.CLIP_EMBED, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_EMBED),
  });
}

/** Create Image Ingest Queue — HTTP download + hash + pHash + palette. */
export function createImageIngestQueue(
  connection: Redis,
): Queue<ImageIngestPayload> {
  return new Queue<ImageIngestPayload>(QUEUE_NAMES.IMAGE_INGEST, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.IMAGE_INGEST),
  });
}

/** Create Image Label Queue — Gemini single-frame VLM + face recognition. */
export function createImageLabelQueue(
  connection: Redis,
): Queue<ImageLabelPayload> {
  return new Queue<ImageLabelPayload>(QUEUE_NAMES.IMAGE_LABEL, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.IMAGE_LABEL),
  });
}

/** Create Image Embed Queue — BGE-M3 text embedding + semantic dedup. */
export function createImageEmbedQueue(
  connection: Redis,
): Queue<ImageEmbedPayload> {
  return new Queue<ImageEmbedPayload>(QUEUE_NAMES.IMAGE_EMBED, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.IMAGE_EMBED),
  });
}

/**
 * Create Clip Selection Queue
 *
 * Queue for the AI clip selection agent: LLM call + N batch vector retrievals.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipSelectionPayload>
 */
export function createClipSelectionQueue(
  connection: Redis,
): Queue<ClipSelectionPayload> {
  return new Queue<ClipSelectionPayload>(QUEUE_NAMES.CLIP_SELECTION, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_SELECTION),
  });
}

/**
 * Create Clip Retag Queue
 *
 * Queue for re-assigning vocabulary tags from existing ai_description using Claude Haiku.
 * Used when vocabulary is added or changed after initial VLM labeling.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipRetagPayload>
 */
export function createClipRetagQueue(
  connection: Redis,
): Queue<ClipRetagPayload> {
  return new Queue<ClipRetagPayload>(QUEUE_NAMES.CLIP_RETAG, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_RETAG),
  });
}

/**
 * Create Clip Extract Queue
 *
 * Queue for FFmpeg extraction of scene cuts into individual MP4 files.
 * One job per source_video; materializes all its clips.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<ClipExtractPayload>
 */
export function createClipExtractQueue(
  connection: Redis,
): Queue<ClipExtractPayload> {
  return new Queue<ClipExtractPayload>(QUEUE_NAMES.CLIP_EXTRACT, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CLIP_EXTRACT),
  });
}

export function createDramaTTSQueue(connection: Redis): Queue<DramaTTSPayload> {
  return new Queue<DramaTTSPayload>(QUEUE_NAMES.DRAMA_TTS, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_TTS),
  });
}

export function createDramaTranscribeQueue(
  connection: Redis,
): Queue<DramaTranscribePayload> {
  return new Queue<DramaTranscribePayload>(QUEUE_NAMES.DRAMA_TRANSCRIBE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_TRANSCRIBE),
  });
}

export function createDramaPromptGenQueue(
  connection: Redis,
): Queue<DramaPromptGenPayload> {
  return new Queue<DramaPromptGenPayload>(QUEUE_NAMES.DRAMA_PROMPT_GEN, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_PROMPT_GEN),
  });
}

export function createDramaImageGenQueue(
  connection: Redis,
): Queue<DramaImageGenPayload> {
  return new Queue<DramaImageGenPayload>(QUEUE_NAMES.DRAMA_IMAGE_GEN, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_IMAGE_GEN),
  });
}

export function createDramaVideoGenQueue(
  connection: Redis,
): Queue<DramaVideoGenPayload> {
  return new Queue<DramaVideoGenPayload>(QUEUE_NAMES.DRAMA_VIDEO_GEN, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_VIDEO_GEN),
  });
}

export function createDramaAssembleQueue(
  connection: Redis,
): Queue<DramaAssemblePayload> {
  return new Queue<DramaAssemblePayload>(QUEUE_NAMES.DRAMA_ASSEMBLE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_ASSEMBLE),
  });
}

export function createDramaQCQueue(connection: Redis): Queue<DramaQCPayload> {
  return new Queue<DramaQCPayload>(QUEUE_NAMES.DRAMA_QC, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_QC),
  });
}

export function createDramaThumbnailQueue(
  connection: Redis,
): Queue<DramaThumbnailPayload> {
  return new Queue<DramaThumbnailPayload>(QUEUE_NAMES.DRAMA_THUMBNAIL, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.DRAMA_THUMBNAIL),
  });
}

export function createThumbnailQueue(
  connection: Redis,
): Queue<ThumbnailPayload> {
  return new Queue<ThumbnailPayload>(QUEUE_NAMES.THUMBNAIL, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.THUMBNAIL),
  });
}

export function createStockLibraryGenQueue(
  connection: Redis,
): Queue<StockLibraryGenPayload> {
  return new Queue<StockLibraryGenPayload>(QUEUE_NAMES.STOCK_LIBRARY_GEN, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.STOCK_LIBRARY_GEN),
  });
}

export function createTutorialGenerateQueue(
  connection: Redis,
): Queue<TutorialGeneratePayload> {
  return new Queue<TutorialGeneratePayload>(QUEUE_NAMES.TUTORIAL_GENERATE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.TUTORIAL_GENERATE),
  });
}

export function createTutorialSpliceQueue(
  connection: Redis,
): Queue<TutorialSplicePayload> {
  return new Queue<TutorialSplicePayload>(QUEUE_NAMES.TUTORIAL_SPLICE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.TUTORIAL_SPLICE),
  });
}

/**
 * Create Tutorial Stitch Queue
 *
 * Queue for stitching all child segment MP4s of a SIX_MIN_STITCH parent into
 * the final concatenated video. Triggered automatically after all segments complete.
 *
 * @param connection - IORedis connection
 * @returns Typed Queue<TutorialStitchPayload>
 */
export function createTutorialStitchQueue(
  connection: Redis,
): Queue<TutorialStitchPayload> {
  return new Queue<TutorialStitchPayload>(QUEUE_NAMES.TUTORIAL_STITCH, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.TUTORIAL_STITCH),
  });
}

export function createReactorDownloadQueue(
  connection: Redis,
): Queue<ReactorDownloadPayload> {
  return new Queue<ReactorDownloadPayload>(QUEUE_NAMES.REACTOR_DOWNLOAD, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.REACTOR_DOWNLOAD),
  });
}

// ── Clip Forge queues (recovered 2026-06-17) ──────────────────────────────
export function createCfIngestQueue(
  connection: Redis,
): Queue<ClipForgeIngestPayload> {
  return new Queue<ClipForgeIngestPayload>(QUEUE_NAMES.CF_INGEST, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CF_INGEST),
  });
}

export function createCfClipDetectionQueue(
  connection: Redis,
): Queue<ClipForgeClipDetectionPayload> {
  return new Queue<ClipForgeClipDetectionPayload>(
    QUEUE_NAMES.CF_CLIP_DETECTION,
    {
      connection,
      ...getQueueOptions(QUEUE_NAMES.CF_CLIP_DETECTION),
    },
  );
}

export function createCfRawRenderQueue(
  connection: Redis,
): Queue<ClipForgeRawRenderPayload> {
  return new Queue<ClipForgeRawRenderPayload>(QUEUE_NAMES.CF_RAW_RENDER, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.CF_RAW_RENDER),
  });
}

export function createCfFinishingRenderQueue(
  connection: Redis,
): Queue<ClipForgeFinishingRenderPayload> {
  return new Queue<ClipForgeFinishingRenderPayload>(
    QUEUE_NAMES.CF_FINISHING_RENDER,
    {
      connection,
      ...getQueueOptions(QUEUE_NAMES.CF_FINISHING_RENDER),
    },
  );
}

export function createReactorTranscribeQueue(
  connection: Redis,
): Queue<ReactorTranscribePayload> {
  return new Queue<ReactorTranscribePayload>(QUEUE_NAMES.REACTOR_TRANSCRIBE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.REACTOR_TRANSCRIBE),
  });
}

export function createReactorScriptQueue(
  connection: Redis,
): Queue<ReactorScriptPayload> {
  return new Queue<ReactorScriptPayload>(QUEUE_NAMES.REACTOR_SCRIPT, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.REACTOR_SCRIPT),
  });
}

export function createReactorTTSQueue(
  connection: Redis,
): Queue<ReactorTTSPayload> {
  return new Queue<ReactorTTSPayload>(QUEUE_NAMES.REACTOR_TTS, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.REACTOR_TTS),
  });
}

export function createReactorAssembleQueue(
  connection: Redis,
): Queue<ReactorAssemblePayload> {
  return new Queue<ReactorAssemblePayload>(QUEUE_NAMES.REACTOR_ASSEMBLE, {
    connection,
    ...getQueueOptions(QUEUE_NAMES.REACTOR_ASSEMBLE),
  });
}

// ── Tech Comparison footage collection ──────────────────────────────────────

export function createTechFootageCollectionQueue(
  connection: Redis,
): Queue<TechFootageCollectionPayload> {
  return new Queue<TechFootageCollectionPayload>(
    QUEUE_NAMES.TECH_FOOTAGE_COLLECTION,
    {
      connection,
      ...getQueueOptions(QUEUE_NAMES.TECH_FOOTAGE_COLLECTION),
    },
  );
}
