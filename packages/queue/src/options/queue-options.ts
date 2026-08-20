import { QueueOptions } from "bullmq";
import { QUEUE_NAMES } from "../constants/queue-names.js";

/**
 * Default Queue Options
 *
 * Sensible defaults for each queue lane based on workload profile.
 * Apps can override these when creating queues.
 *
 * Note: These are job-level defaults. Connection options are provided by the caller.
 */

/**
 * Base options shared by all queues (excludes connection, which is app-provided)
 *
 * Hardened defaults:
 * - 3 attempts with exponential backoff
 * - removeOnComplete: keep last 500 or 1 day
 * - removeOnFail: keep 200 failures for 7 days
 */
const baseQueueOptions = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500, age: 86400 },
    removeOnFail: { count: 200, age: 604800 },
  },
} as Omit<QueueOptions, "connection">;

/**
 * Ingest Queue Options
 * - High concurrency, short timeout
 * - Lightweight job creation
 */
export const ingestQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
} as Omit<QueueOptions, "connection">;

/**
 * AI Generation Queue Options
 * - Medium concurrency, longer timeout (external API calls)
 * - Retry with exponential backoff for API rate limits
 * - 30s initial backoff: AI33 rate limits need time to reset (5s was too short)
 *   Retry schedule: 30s → 60s → 120s (3 attempts total)
 */
export const aiGenerationQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
    timeout: 120000, // 2 minutes for external API calls
    removeOnComplete: true, // Remove immediately — state is tracked in DB, not BullMQ history
    removeOnFail: true, // Remove immediately — prevents dedup blocking on re-dispatch
  },
} as Omit<QueueOptions, "connection">;

/**
 * Asset Collection Queue Options
 * - High concurrency (lightweight coordination)
 * - Orchestrates multi-step asset generation pipeline
 */
export const assetCollectionQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 60000, // 1 minute for coordination tasks
  },
} as Omit<QueueOptions, "connection">;

/**
 * QMS Validation Queue Options
 * - High concurrency, short timeout
 * - Fast pre-flight checks
 */
export const qmsValidationQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 30000, // 30 seconds for pre-flight checks
  },
} as Omit<QueueOptions, "connection">;

/**
 * Render Heavy Queue Options
 * - Concurrency 1-4 per VPS (autoscaler-managed), very long timeout
 * - CPU-bound rendering
 * - 2 attempts only — render failures are expensive, retry once
 * - removeOnFail: false — keep ALL render failures for manual inspection
 */
export const renderHeavyQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 30000 },
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: false,
    timeout: 10_800_000, // 3 hours — covers 40-min long-form Remotion renders
  },
} as Omit<QueueOptions, "connection">;

/**
 * Garbage Collection Queue Options
 * - Low concurrency, medium timeout
 * - Asset cleanup operations
 */
export const garbageCollectionQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 300000, // 5 minutes for asset cleanup
  },
} as Omit<QueueOptions, "connection">;

/**
 * Scene Analysis Queue Options
 * - Medium concurrency (3 concurrent LLM calls)
 * - LLM API timeout (~60s for complex scripts)
 */
export const sceneAnalysisQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 120000, // 2 minutes for LLM scene decomposition
  },
} as Omit<QueueOptions, "connection">;

/**
 * Auto-Label Queue Options
 * - Low concurrency (2 jobs at a time — local Ollama)
 * - Medium timeout (60s — small LLM generation)
 * - 2 retries only — Ollama failures are usually transient
 */
export const autoLabelQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 2,
    backoff: { type: "fixed", delay: 10000 },
    timeout: 60000,
  },
} as Omit<QueueOptions, "connection">;

/**
 * Dead Letter Queue Options
 * - Manual processing only, no automatic retries
 */
export const deadLetterQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 1,
    removeOnComplete: {
      count: 1000, // Keep more dead letter jobs
    },
    removeOnFail: false, // Never auto-remove failed jobs
  },
} as Omit<QueueOptions, "connection">;

/**
 * Video Stitch Queue Options
 * - Concurrency 1 (fixed), capacity-limited worker
 * - Long timeout (handles 30+ minute stitched videos)
 * - 3 attempts with longer backoff (normalization + Remotion rendering is expensive)
 * - Keep failures for inspection
 */
export const videoStitchQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
    removeOnComplete: { count: 100, age: 86400 * 7 }, // Keep 7 days
    removeOnFail: { count: 50, age: 86400 * 30 }, // Keep failures 30 days
    timeout: 7_200_000, // 2 hours — handles normalization + stitching + transitions
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Ingest Queue Options
 * - I/O-bound (download + scene detection). Concurrency 3.
 * - Generous timeout to handle large video downloads over slow connections.
 */
export const clipIngestQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    timeout: 1_800_000, // 30 min — handles large video downloads
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Label Queue Options
 * - GPU-serialized. Concurrency MUST be 1. VLM + Whisper large-v3 + face + audio.
 * - Timeout generous because large-v3 whisper on a 3-min clip can take 90s.
 * - Longer backoff (30s) — GPU contention clears slowly.
 */
export const clipLabelQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
    timeout: 300_000, // 5 min — GPU labeling pipeline
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Label Batch Queue Options
 * - One job covers a whole source video. Failure here is expensive — only
 *   2 attempts with longer backoff so we don't grind through a 3hr label
 *   pass twice on the wrong day.
 * - Timeout matches worker lock: 3 hr.
 */
export const clipLabelBatchQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { count: 50, age: 7 * 86400 },
    removeOnFail: { count: 50, age: 30 * 86400 },
    timeout: 3 * 60 * 60 * 1000,
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Embed Queue Options
 * - BGE-M3 embedding. Concurrency 5 — CPU-bound, no GPU contention.
 * - Fast per-clip, short timeout.
 */
/**
 * Image Ingest Queue Options
 * - 3 attempts, exponential backoff. Stock APIs flake, file copies don't.
 * - Timeout 10 min — covers slow Pexels API + 100MB image edge cases.
 */
export const imageIngestQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
    timeout: 600_000,
  },
} as Omit<QueueOptions, "connection">;

/** Image Label Queue Options — Gemini pool. 3 attempts × 30s exp backoff. */
export const imageLabelQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
    timeout: 300_000,
  },
} as Omit<QueueOptions, "connection">;

/** Image Embed Queue Options — BGE-M3 sidecar. Fast, short timeout. */
export const imageEmbedQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    timeout: 60_000,
  },
} as Omit<QueueOptions, "connection">;

export const clipEmbedQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 60_000, // 1 min
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Selection Queue Options
 * - AI agent: 1 LLM call + N batch vector retrievals. Concurrency 2.
 * - Large scripts with many retrieval batches can take several minutes.
 * - 2 attempts only — selection failures reflect bad input, not transient errors.
 */
export const clipSelectionQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 2,
    backoff: { type: "fixed", delay: 15000 },
    timeout: 600_000, // 10 min — large scripts with many batches
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Retag Queue Options
 * - Claude Haiku API calls for tag assignment from description. Concurrency 5.
 * - Fast per-clip. 2 minute timeout covers API latency.
 */
export const clipRetagQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 120_000, // 2 min
  },
} as Omit<QueueOptions, "connection">;

/**
 * Clip Extract Queue Options
 * - FFmpeg stream-copy extraction per source_video. Concurrency 2.
 * - 2 hour timeout handles large libraries (2000+ clips × ~3s each).
 */
export const clipExtractQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    timeout: 7_200_000, // 2 hours — handles full library backfill
  },
} as Omit<QueueOptions, "connection">;

/**
 * Drama Queue Options (all 7 stages use base defaults)
 * Individual lock/timeout tuning is handled in worker options.
 */
export const dramaTTSQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaTranscribeQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaPromptGenQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaImageGenQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaVideoGenQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaAssembleQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaQCQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const dramaThumbnailQueueOptions = { ...baseQueueOptions } as Omit<
  QueueOptions,
  "connection"
>;
export const thumbnailQueueOptions = {
  ...baseQueueOptions,
  defaultJobOptions: {
    ...baseQueueOptions.defaultJobOptions,
    // Thumbnail state lives in the DB (thumbnails table), not BullMQ history.
    // The auto-enqueue uses a fixed jobId (`thumbnail-<subjectId>`); retaining a
    // completed/failed job would dedup-block a legitimate re-generation for
    // hours/days. Remove immediately so re-dispatch always works.
    removeOnComplete: true,
    removeOnFail: true,
  },
} as Omit<QueueOptions, "connection">;
export const stockLibraryGenQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

/**
 * Tutorial Generate Queue Options
 * - LLM script generation + TTS synthesis. Concurrency 4.
 * - Network I/O bound (LLM + TTS APIs). Extended lock (30 min).
 */
export const tutorialGenerateQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

/**
 * Tutorial Splice Queue Options
 * - FFmpeg mux TTS onto recording. Concurrency 2.
 * - CPU-bound (FFmpeg). Extended lock (30 min).
 */
export const tutorialSpliceQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

/**
 * Tutorial Stitch Queue Options
 * - FFmpeg concat demuxer to join segment MP4s into the parent final.mp4.
 * - Concurrency 1 (CPU-bound), short lock (jobs complete quickly via stream copy).
 */
export const tutorialStitchQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

export const reactorDownloadQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

export const reactorTranscribeQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

export const reactorScriptQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

export const reactorTTSQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

export const reactorAssembleQueueOptions = {
  ...baseQueueOptions,
} as Omit<QueueOptions, "connection">;

/**
 * Get queue options by queue name
 */
export function getQueueOptions(
  queueName: string,
): Omit<QueueOptions, "connection"> {
  switch (queueName) {
    case QUEUE_NAMES.INGEST:
      return ingestQueueOptions;
    case QUEUE_NAMES.AI_GENERATION:
      return aiGenerationQueueOptions;
    case QUEUE_NAMES.ASSET_COLLECTION:
      return assetCollectionQueueOptions;
    case QUEUE_NAMES.QMS_VALIDATION:
      return qmsValidationQueueOptions;
    case QUEUE_NAMES.RENDER_HEAVY:
      return renderHeavyQueueOptions;
    case QUEUE_NAMES.GARBAGE_COLLECTION:
      return garbageCollectionQueueOptions;
    case QUEUE_NAMES.SCENE_ANALYSIS:
      return sceneAnalysisQueueOptions;
    case QUEUE_NAMES.AUTO_LABEL:
      return autoLabelQueueOptions;
    case QUEUE_NAMES.DEAD_LETTER:
      return deadLetterQueueOptions;
    case QUEUE_NAMES.VIDEO_STITCH:
      return videoStitchQueueOptions;
    case QUEUE_NAMES.CLIP_INGEST:
      return clipIngestQueueOptions;
    case QUEUE_NAMES.CLIP_LABEL:
      return clipLabelQueueOptions;
    case QUEUE_NAMES.CLIP_LABEL_BATCH:
      return clipLabelBatchQueueOptions;
    case QUEUE_NAMES.CLIP_EMBED:
      return clipEmbedQueueOptions;
    case QUEUE_NAMES.IMAGE_INGEST:
      return imageIngestQueueOptions;
    case QUEUE_NAMES.IMAGE_LABEL:
      return imageLabelQueueOptions;
    case QUEUE_NAMES.IMAGE_EMBED:
      return imageEmbedQueueOptions;
    case QUEUE_NAMES.CLIP_SELECTION:
      return clipSelectionQueueOptions;
    case QUEUE_NAMES.CLIP_RETAG:
      return clipRetagQueueOptions;
    case QUEUE_NAMES.CLIP_EXTRACT:
      return clipExtractQueueOptions;
    case QUEUE_NAMES.DRAMA_TTS:
      return dramaTTSQueueOptions;
    case QUEUE_NAMES.DRAMA_TRANSCRIBE:
      return dramaTranscribeQueueOptions;
    case QUEUE_NAMES.DRAMA_PROMPT_GEN:
      return dramaPromptGenQueueOptions;
    case QUEUE_NAMES.DRAMA_IMAGE_GEN:
      return dramaImageGenQueueOptions;
    case QUEUE_NAMES.DRAMA_VIDEO_GEN:
      return dramaVideoGenQueueOptions;
    case QUEUE_NAMES.DRAMA_ASSEMBLE:
      return dramaAssembleQueueOptions;
    case QUEUE_NAMES.DRAMA_QC:
      return dramaQCQueueOptions;
    case QUEUE_NAMES.DRAMA_THUMBNAIL:
      return dramaThumbnailQueueOptions;
    case QUEUE_NAMES.THUMBNAIL:
      return thumbnailQueueOptions;
    case QUEUE_NAMES.STOCK_LIBRARY_GEN:
      return stockLibraryGenQueueOptions;
    case QUEUE_NAMES.TUTORIAL_GENERATE:
      return tutorialGenerateQueueOptions;
    case QUEUE_NAMES.TUTORIAL_SPLICE:
      return tutorialSpliceQueueOptions;
    case QUEUE_NAMES.TUTORIAL_STITCH:
      return tutorialStitchQueueOptions;
    case QUEUE_NAMES.REACTOR_DOWNLOAD:
      return reactorDownloadQueueOptions;
    case QUEUE_NAMES.REACTOR_TRANSCRIBE:
      return reactorTranscribeQueueOptions;
    case QUEUE_NAMES.REACTOR_SCRIPT:
      return reactorScriptQueueOptions;
    case QUEUE_NAMES.REACTOR_TTS:
      return reactorTTSQueueOptions;
    case QUEUE_NAMES.REACTOR_ASSEMBLE:
      return reactorAssembleQueueOptions;
    default:
      return baseQueueOptions;
  }
}
