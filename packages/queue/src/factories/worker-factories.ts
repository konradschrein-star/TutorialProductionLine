import { Worker, Job } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "../constants/queue-names.js";
import { getWorkerOptions } from "../options/worker-options.js";
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
  ClipIngestPayload,
  ClipLabelPayload,
  ClipLabelBatchPayload,
  ImageIngestPayload,
  ImageLabelPayload,
  ImageEmbedPayload,
  ClipEmbedPayload,
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
  TutorialTranslatePayload,
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
 * Typed Worker Factories
 *
 * Factory functions that create typed Worker<PayloadType> instances.
 * Each factory enforces the correct payload type in the processor function.
 *
 * Design:
 * - Type safety: processor functions receive correctly typed job.data
 * - No singletons: apps manage worker lifecycle
 * - Default options: sensible defaults per workload profile (can be overridden)
 */

/**
 * Processor function type
 * Generic over payload type for type safety
 */
export type Processor<T> = (job: Job<T>) => Promise<void>;

/**
 * Create Ingest Worker
 *
 * Worker for initial job creation and workflow setup.
 *
 * @param connection - IORedis connection (from createRedisConnection)
 * @param processor - Job processor function with typed IngestPayload
 * @returns Typed Worker<IngestPayload>
 */
export function createIngestWorker(
  connection: Redis,
  processor: Processor<IngestPayload>,
): Worker<IngestPayload> {
  return new Worker<IngestPayload>(QUEUE_NAMES.INGEST, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.INGEST),
  });
}

/**
 * Create AI Generation Worker
 *
 * Worker for TTS, LLM API calls, and external AI services.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed AIGenerationPayload
 * @returns Typed Worker<AIGenerationPayload>
 */
export function createAIGenerationWorker(
  connection: Redis,
  processor: Processor<AIGenerationPayload>,
): Worker<AIGenerationPayload> {
  return new Worker<AIGenerationPayload>(QUEUE_NAMES.AI_GENERATION, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.AI_GENERATION),
  });
}

/**
 * Create Asset Collection Worker
 *
 * Worker for asset collection pipeline coordination.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed payload
 * @returns Typed Worker<{ job_id: string }>
 */
export function createAssetCollectionWorker(
  connection: Redis,
  processor: Processor<{ job_id: string }>,
): Worker<{ job_id: string }> {
  return new Worker<{ job_id: string }>(
    QUEUE_NAMES.ASSET_COLLECTION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.ASSET_COLLECTION),
    },
  );
}

/**
 * Create QMS Validation Worker
 *
 * Worker for lightweight pre-flight checks before expensive operations.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed QMSValidationPayload
 * @returns Typed Worker<QMSValidationPayload>
 */
export function createQMSValidationWorker(
  connection: Redis,
  processor: Processor<QMSValidationPayload>,
): Worker<QMSValidationPayload> {
  return new Worker<QMSValidationPayload>(
    QUEUE_NAMES.QMS_VALIDATION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.QMS_VALIDATION),
    },
  );
}

/**
 * Create Render Heavy Worker
 *
 * Worker for FFmpeg/Remotion CPU-bound rendering.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed RenderHeavyPayload
 * @returns Typed Worker<RenderHeavyPayload>
 */
export function createRenderHeavyWorker(
  connection: Redis,
  processor: Processor<RenderHeavyPayload>,
): Worker<RenderHeavyPayload> {
  return new Worker<RenderHeavyPayload>(QUEUE_NAMES.RENDER_HEAVY, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.RENDER_HEAVY),
  });
}

/**
 * Create Garbage Collection Worker
 *
 * Worker for R2 asset deletion and zombie cleanup.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed GarbageCollectionPayload
 * @returns Typed Worker<GarbageCollectionPayload>
 */
export function createGarbageCollectionWorker(
  connection: Redis,
  processor: Processor<GarbageCollectionPayload>,
): Worker<GarbageCollectionPayload> {
  return new Worker<GarbageCollectionPayload>(
    QUEUE_NAMES.GARBAGE_COLLECTION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.GARBAGE_COLLECTION),
    },
  );
}

/**
 * Create Scene Analysis Worker
 *
 * Worker for LLM-based script decomposition into structured scenes.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed SceneAnalysisPayload
 * @returns Typed Worker<SceneAnalysisPayload>
 */
export function createSceneAnalysisWorker(
  connection: Redis,
  processor: Processor<SceneAnalysisPayload>,
): Worker<SceneAnalysisPayload> {
  return new Worker<SceneAnalysisPayload>(
    QUEUE_NAMES.SCENE_ANALYSIS,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.SCENE_ANALYSIS),
    },
  );
}

/**
 * Create Auto-Label Worker
 *
 * Worker for automatic asset description + tag generation via local Ollama.
 * Reads generation_recipe.prompt_template from the asset row and calls Ollama.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed { job_id: string } payload
 * @returns Typed Worker<{ job_id: string }>
 */
export function createAutoLabelWorker(
  connection: Redis,
  processor: Processor<{ job_id: string }>,
): Worker<{ job_id: string }> {
  return new Worker<{ job_id: string }>(QUEUE_NAMES.AUTO_LABEL, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.AUTO_LABEL),
  });
}

/**
 * Create Dead Letter Worker
 *
 * Worker for irrecoverable failures requiring manual inspection.
 * No automatic processing - manual intervention only.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function (untyped - accepts any failed job)
 * @returns Worker for dead letter jobs
 */
export function createDeadLetterWorker(
  connection: Redis,
  processor: Processor<unknown>,
): Worker {
  return new Worker(QUEUE_NAMES.DEAD_LETTER, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.DEAD_LETTER),
  });
}

/**
 * Create Bundestag Clip Analysis Worker
 *
 * Worker for transcription and analysis of parliamentary debate clips.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed BundestagClipAnalysisPayload
 * @returns Typed Worker<BundestagClipAnalysisPayload>
 */
export function createBundestagClipAnalysisWorker(
  connection: Redis,
  processor: Processor<BundestagClipAnalysisPayload>,
): Worker<BundestagClipAnalysisPayload> {
  return new Worker<BundestagClipAnalysisPayload>(
    QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS),
    },
  );
}

/**
 * Create Bundestag Playbook Generation Worker
 *
 * Worker for LLM-based editing playbook generation from analyzed clips.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed BundestagPlaybookGenerationPayload
 * @returns Typed Worker<BundestagPlaybookGenerationPayload>
 */
export function createBundestagPlaybookGenerationWorker(
  connection: Redis,
  processor: Processor<BundestagPlaybookGenerationPayload>,
): Worker<BundestagPlaybookGenerationPayload> {
  return new Worker<BundestagPlaybookGenerationPayload>(
    QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION),
    },
  );
}

/**
 * Create Bundestag Render Worker
 *
 * Worker for FFmpeg-based video composition using playbook.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed BundestagRenderPayload
 * @returns Typed Worker<BundestagRenderPayload>
 */
export function createBundestagRenderWorker(
  connection: Redis,
  processor: Processor<BundestagRenderPayload>,
): Worker<BundestagRenderPayload> {
  return new Worker<BundestagRenderPayload>(
    QUEUE_NAMES.BUNDESTAG_RENDER,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.BUNDESTAG_RENDER),
    },
  );
}

/**
 * Create Clip Ingest Worker
 *
 * Worker for downloading source video and running scene detection.
 * Concurrency 3 — I/O-bound, safe to parallelize.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipIngestPayload
 * @returns Typed Worker<ClipIngestPayload>
 */
export function createClipIngestWorker(
  connection: Redis,
  processor: Processor<ClipIngestPayload>,
): Worker<ClipIngestPayload> {
  return new Worker<ClipIngestPayload>(QUEUE_NAMES.CLIP_INGEST, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CLIP_INGEST),
  });
}

/**
 * Create Clip Label Worker
 *
 * GPU-serialized worker for VLM + Whisper large-v3 + face + audio analysis.
 * Concurrency is fixed at 1 — GPU contention causes OOM at concurrency > 1.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipLabelPayload
 * @returns Typed Worker<ClipLabelPayload>
 */
export function createClipLabelWorker(
  connection: Redis,
  processor: Processor<ClipLabelPayload>,
): Worker<ClipLabelPayload> {
  return new Worker<ClipLabelPayload>(QUEUE_NAMES.CLIP_LABEL, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CLIP_LABEL),
  });
}

/**
 * Create Clip Label Batch Worker
 *
 * Coarse-grained worker — one job per source_video. Inside the processor we
 * walk clip_index order and label each clip in turn, threading the previous
 * scene_context forward as context for the next. Concurrency 2 — labels
 * still go through the per-library SimpleConcurrencyLimiter to avoid pool
 * starvation when many batches run together.
 */
export function createClipLabelBatchWorker(
  connection: Redis,
  processor: Processor<ClipLabelBatchPayload>,
): Worker<ClipLabelBatchPayload> {
  return new Worker<ClipLabelBatchPayload>(
    QUEUE_NAMES.CLIP_LABEL_BATCH,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.CLIP_LABEL_BATCH),
    },
  );
}

/**
 * Create Clip Embed Worker
 *
 * Worker for BGE-M3 dense + sparse embedding of clip metadata.
 * Concurrency 5 — CPU-bound, no GPU contention.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipEmbedPayload
 * @returns Typed Worker<ClipEmbedPayload>
 */
export function createClipEmbedWorker(
  connection: Redis,
  processor: Processor<ClipEmbedPayload>,
): Worker<ClipEmbedPayload> {
  return new Worker<ClipEmbedPayload>(QUEUE_NAMES.CLIP_EMBED, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CLIP_EMBED),
  });
}

/** Image Ingest Worker — HTTP download / file copy + hash + pHash + palette. */
export function createImageIngestWorker(
  connection: Redis,
  processor: Processor<ImageIngestPayload>,
): Worker<ImageIngestPayload> {
  return new Worker<ImageIngestPayload>(QUEUE_NAMES.IMAGE_INGEST, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.IMAGE_INGEST),
  });
}

/** Image Label Worker — Gemini single-frame VLM + face recognition. */
export function createImageLabelWorker(
  connection: Redis,
  processor: Processor<ImageLabelPayload>,
): Worker<ImageLabelPayload> {
  return new Worker<ImageLabelPayload>(QUEUE_NAMES.IMAGE_LABEL, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.IMAGE_LABEL),
  });
}

/** Image Embed Worker — BGE-M3 text embedding + semantic dedup. */
export function createImageEmbedWorker(
  connection: Redis,
  processor: Processor<ImageEmbedPayload>,
): Worker<ImageEmbedPayload> {
  return new Worker<ImageEmbedPayload>(QUEUE_NAMES.IMAGE_EMBED, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.IMAGE_EMBED),
  });
}

/**
 * Create Clip Selection Worker
 *
 * Worker for the AI clip selection agent: LLM call + N batch vector retrievals.
 * Concurrency 2 — network I/O bound.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipSelectionPayload
 * @returns Typed Worker<ClipSelectionPayload>
 */
export function createClipSelectionWorker(
  connection: Redis,
  processor: Processor<ClipSelectionPayload>,
): Worker<ClipSelectionPayload> {
  return new Worker<ClipSelectionPayload>(
    QUEUE_NAMES.CLIP_SELECTION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.CLIP_SELECTION),
    },
  );
}

/**
 * Create Clip Retag Worker
 *
 * Worker for re-assigning vocabulary tags from existing ai_description.
 * Concurrency 5 — LLM API calls, network I/O bound.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipRetagPayload
 * @returns Typed Worker<ClipRetagPayload>
 */
export function createClipRetagWorker(
  connection: Redis,
  processor: Processor<ClipRetagPayload>,
): Worker<ClipRetagPayload> {
  return new Worker<ClipRetagPayload>(QUEUE_NAMES.CLIP_RETAG, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CLIP_RETAG),
  });
}

/**
 * Create Clip Extract Worker
 *
 * Worker for FFmpeg stream-copy extraction of clips into individual MP4s.
 * Concurrency 2 — I/O-bound, safe to parallelize.
 *
 * @param connection - IORedis connection
 * @param processor - Job processor function with typed ClipExtractPayload
 * @returns Typed Worker<ClipExtractPayload>
 */
export function createClipExtractWorker(
  connection: Redis,
  processor: Processor<ClipExtractPayload>,
): Worker<ClipExtractPayload> {
  return new Worker<ClipExtractPayload>(QUEUE_NAMES.CLIP_EXTRACT, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CLIP_EXTRACT),
  });
}

export function createDramaTTSWorker(
  connection: Redis,
  processor: Processor<DramaTTSPayload>,
): Worker<DramaTTSPayload> {
  return new Worker<DramaTTSPayload>(QUEUE_NAMES.DRAMA_TTS, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.DRAMA_TTS),
  });
}

export function createDramaTranscribeWorker(
  connection: Redis,
  processor: Processor<DramaTranscribePayload>,
): Worker<DramaTranscribePayload> {
  return new Worker<DramaTranscribePayload>(
    QUEUE_NAMES.DRAMA_TRANSCRIBE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_TRANSCRIBE) },
  );
}

export function createDramaPromptGenWorker(
  connection: Redis,
  processor: Processor<DramaPromptGenPayload>,
): Worker<DramaPromptGenPayload> {
  return new Worker<DramaPromptGenPayload>(
    QUEUE_NAMES.DRAMA_PROMPT_GEN,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_PROMPT_GEN) },
  );
}

export function createDramaImageGenWorker(
  connection: Redis,
  processor: Processor<DramaImageGenPayload>,
): Worker<DramaImageGenPayload> {
  return new Worker<DramaImageGenPayload>(
    QUEUE_NAMES.DRAMA_IMAGE_GEN,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_IMAGE_GEN) },
  );
}

export function createDramaVideoGenWorker(
  connection: Redis,
  processor: Processor<DramaVideoGenPayload>,
): Worker<DramaVideoGenPayload> {
  return new Worker<DramaVideoGenPayload>(
    QUEUE_NAMES.DRAMA_VIDEO_GEN,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_VIDEO_GEN) },
  );
}

export function createDramaAssembleWorker(
  connection: Redis,
  processor: Processor<DramaAssemblePayload>,
): Worker<DramaAssemblePayload> {
  return new Worker<DramaAssemblePayload>(
    QUEUE_NAMES.DRAMA_ASSEMBLE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_ASSEMBLE) },
  );
}

export function createDramaQCWorker(
  connection: Redis,
  processor: Processor<DramaQCPayload>,
): Worker<DramaQCPayload> {
  return new Worker<DramaQCPayload>(QUEUE_NAMES.DRAMA_QC, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.DRAMA_QC),
  });
}

export function createDramaThumbnailWorker(
  connection: Redis,
  processor: Processor<DramaThumbnailPayload>,
): Worker<DramaThumbnailPayload> {
  return new Worker<DramaThumbnailPayload>(
    QUEUE_NAMES.DRAMA_THUMBNAIL,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.DRAMA_THUMBNAIL) },
  );
}

export function createThumbnailWorker(
  connection: Redis,
  processor: Processor<ThumbnailPayload>,
): Worker<ThumbnailPayload> {
  return new Worker<ThumbnailPayload>(QUEUE_NAMES.THUMBNAIL, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.THUMBNAIL),
  });
}

export function createStockLibraryGenWorker(
  connection: Redis,
  processor: Processor<StockLibraryGenPayload>,
): Worker<StockLibraryGenPayload> {
  return new Worker<StockLibraryGenPayload>(
    QUEUE_NAMES.STOCK_LIBRARY_GEN,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.STOCK_LIBRARY_GEN) },
  );
}

export function createTutorialGenerateWorker(
  connection: Redis,
  processor: Processor<TutorialGeneratePayload>,
): Worker<TutorialGeneratePayload> {
  return new Worker<TutorialGeneratePayload>(
    QUEUE_NAMES.TUTORIAL_GENERATE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.TUTORIAL_GENERATE) },
  );
}

export function createTutorialSpliceWorker(
  connection: Redis,
  processor: Processor<TutorialSplicePayload>,
): Worker<TutorialSplicePayload> {
  return new Worker<TutorialSplicePayload>(
    QUEUE_NAMES.TUTORIAL_SPLICE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.TUTORIAL_SPLICE) },
  );
}

export function createTutorialTranslateWorker(
  connection: Redis,
  processor: Processor<TutorialTranslatePayload>,
): Worker<TutorialTranslatePayload> {
  return new Worker<TutorialTranslatePayload>(
    QUEUE_NAMES.TUTORIAL_TRANSLATE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.TUTORIAL_TRANSLATE) },
  );
}

/**
 * Create Tutorial Stitch Worker
 *
 * Worker for the TUTORIAL_STITCH lane. Concatenates all child segment MP4s of a
 * SIX_MIN_STITCH parent into a single final.mp4 using ffmpeg concat demuxer.
 * Concurrency 1, lock 20 min.
 *
 * @param connection - IORedis worker connection
 * @param processor  - Processor function receiving TutorialStitchPayload
 */
export function createTutorialStitchWorker(
  connection: Redis,
  processor: Processor<TutorialStitchPayload>,
): Worker<TutorialStitchPayload> {
  return new Worker<TutorialStitchPayload>(
    QUEUE_NAMES.TUTORIAL_STITCH,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.TUTORIAL_STITCH) },
  );
}

export function createReactorDownloadWorker(
  connection: Redis,
  processor: Processor<ReactorDownloadPayload>,
): Worker<ReactorDownloadPayload> {
  return new Worker<ReactorDownloadPayload>(
    QUEUE_NAMES.REACTOR_DOWNLOAD,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.REACTOR_DOWNLOAD) },
  );
}

export function createReactorTranscribeWorker(
  connection: Redis,
  processor: Processor<ReactorTranscribePayload>,
): Worker<ReactorTranscribePayload> {
  return new Worker<ReactorTranscribePayload>(
    QUEUE_NAMES.REACTOR_TRANSCRIBE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.REACTOR_TRANSCRIBE) },
  );
}

export function createReactorScriptWorker(
  connection: Redis,
  processor: Processor<ReactorScriptPayload>,
): Worker<ReactorScriptPayload> {
  return new Worker<ReactorScriptPayload>(
    QUEUE_NAMES.REACTOR_SCRIPT,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.REACTOR_SCRIPT) },
  );
}

export function createReactorTTSWorker(
  connection: Redis,
  processor: Processor<ReactorTTSPayload>,
): Worker<ReactorTTSPayload> {
  return new Worker<ReactorTTSPayload>(QUEUE_NAMES.REACTOR_TTS, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.REACTOR_TTS),
  });
}

export function createReactorAssembleWorker(
  connection: Redis,
  processor: Processor<ReactorAssemblePayload>,
): Worker<ReactorAssemblePayload> {
  return new Worker<ReactorAssemblePayload>(
    QUEUE_NAMES.REACTOR_ASSEMBLE,
    processor,
    { connection, ...getWorkerOptions(QUEUE_NAMES.REACTOR_ASSEMBLE) },
  );
}

// ── Clip Forge ─────────────────────────────────────────────────────────────
//
// IMPORTANT: lockDuration / maxStalledCount overrides.
//
// BullMQ's default lockDuration is 30s with maxStalledCount=1. That's
// catastrophic for the cf-ingest worker, which runs Whisper on a long VOD
// inside a child process — a single 30-second hiccup in the Node event
// loop (e.g. a GC pause during a memory-heavy Whisper run) marks the job
// stalled, kills the subprocess, and we lose an hour of transcription.
//
// We set lockDuration to 6 hours and maxStalledCount to 10 so the job
// survives system pressure. The processor ALSO calls job.extendLock()
// explicitly every minute (see ingest.ts) so the lease never expires
// even when the worker is busy.

export function createCfIngestWorker(
  connection: Redis,
  processor: Processor<ClipForgeIngestPayload>,
): Worker<ClipForgeIngestPayload> {
  // Spread base FIRST so our explicit overrides win. The previous order
  // had base last and silently clobbered lockDuration back to 60s, which
  // killed every multi-minute Whisper run with a stalled-job timeout.
  return new Worker<ClipForgeIngestPayload>(QUEUE_NAMES.CF_INGEST, processor, {
    connection,
    ...getWorkerOptions(QUEUE_NAMES.CF_INGEST),
    concurrency: 2,
    lockDuration: 6 * 60 * 60 * 1000,
    maxStalledCount: 10,
    stalledInterval: 5 * 60 * 1000,
  });
}

export function createCfClipDetectionWorker(
  connection: Redis,
  processor: Processor<ClipForgeClipDetectionPayload>,
): Worker<ClipForgeClipDetectionPayload> {
  return new Worker<ClipForgeClipDetectionPayload>(
    QUEUE_NAMES.CF_CLIP_DETECTION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.CF_CLIP_DETECTION),
      concurrency: 3,
      lockDuration: 10 * 60 * 1000,
      maxStalledCount: 5,
    },
  );
}

export function createCfRawRenderWorker(
  connection: Redis,
  processor: Processor<ClipForgeRawRenderPayload>,
): Worker<ClipForgeRawRenderPayload> {
  return new Worker<ClipForgeRawRenderPayload>(
    QUEUE_NAMES.CF_RAW_RENDER,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.CF_RAW_RENDER),
      concurrency: 1,
      lockDuration: 30 * 60 * 1000,
      maxStalledCount: 5,
    },
  );
}

export function createCfFinishingRenderWorker(
  connection: Redis,
  processor: Processor<ClipForgeFinishingRenderPayload>,
): Worker<ClipForgeFinishingRenderPayload> {
  return new Worker<ClipForgeFinishingRenderPayload>(
    QUEUE_NAMES.CF_FINISHING_RENDER,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.CF_FINISHING_RENDER),
      concurrency: 1,
      lockDuration: 30 * 60 * 1000,
      maxStalledCount: 5,
    },
  );
}

// ── Tech Comparison footage collection ──────────────────────────────────────

export function createTechFootageCollectionWorker(
  connection: Redis,
  processor: Processor<TechFootageCollectionPayload>,
): Worker<TechFootageCollectionPayload> {
  return new Worker<TechFootageCollectionPayload>(
    QUEUE_NAMES.TECH_FOOTAGE_COLLECTION,
    processor,
    {
      connection,
      ...getWorkerOptions(QUEUE_NAMES.TECH_FOOTAGE_COLLECTION),
      concurrency: 2,
      lockDuration: 10 * 60 * 1000,
      maxStalledCount: 3,
    },
  );
}
