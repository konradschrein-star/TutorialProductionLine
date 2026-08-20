import { WorkerOptions } from "bullmq";
import { QUEUE_NAMES } from "../constants/queue-names.js";

/**
 * Default Worker Options
 *
 * Sensible defaults for each queue lane based on workload profile.
 * Apps can override these when creating workers.
 */

/**
 * Base options shared by all workers
 *
 * Hardened defaults:
 * - stalledInterval: 30s (how often to check for stalled jobs)
 * - maxStalledCount: 2 (move to failed after 2 stall checks)
 * - lockDuration: 60s (job lock before it can be reclaimed)
 */
const baseWorkerOptions: Omit<WorkerOptions, "connection"> = {
  autorun: true,
  removeOnComplete: { count: 500, age: 86400 },
  removeOnFail: { count: 200, age: 604800 },
  stalledInterval: 30000,
  maxStalledCount: 2,
  lockDuration: 60000,
};

/**
 * Ingest Worker Options
 * - High concurrency (10 concurrent jobs)
 * - Lightweight async orchestration — DB record creation only
 */
export const ingestWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 10,
};

/**
 * AI Generation Worker Options
 * - Moderate concurrency (5 concurrent API calls)
 * - Network I/O bound — HTTP calls to AI33 image generation API.
 *   Each task does: submit → poll every 5s → download. Zero CPU on our side.
 * - 30 was too high: saturated AI33 rate limits when all scenes fired simultaneously.
 *   Reduced to 8, then to 5 after discovering that even 8 concurrent + no backoff
 *   caused 429 cascades when jobs dispatched in tight loops.
 *   Combined with dispatch staggering (200ms delays) and exponential backoff,
 *   5 concurrent provides sustainable throughput without exhausting rate limits.
 */
export const aiGenerationWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 5,
  // AI33 image polling runs up to MAX_POLL_ATTEMPTS=120 × 5s = 600s (10 min).
  // Base lockDuration=60s causes BullMQ to reclaim the job as stalled mid-poll.
  // 15 min lock + 5 min renewal keeps the lock alive through the full poll window.
  lockDuration: 900_000, // 15 min — outlasts 10 min image polling window
  lockRenewTime: 300_000, // 5 min — renew well before lock expires
  settings: {
    // Exponential backoff for failed API calls (rate limits, timeouts)
    // First retry: 5s, second: 15s, third: 45s, max: 60s
    backoffStrategy: (attemptsMade: number) => {
      return Math.min(5000 * Math.pow(3, attemptsMade - 1), 60000);
    },
  },
};

/**
 * Asset Collection Worker Options
 * - High concurrency (8 concurrent coordination tasks)
 *
 * NO LONGER "lightweight orchestration". That description was accurate once and
 * is now false: the RANKING format does all of its heavy work INLINE inside a
 * single asset-collection job — a DuckDuckGo hero search plus download per
 * item, a yt-dlp search plus ~150s clip download per item (~80s each), an
 * ffmpeg sprite per candidate, full chunked TTS, then Whisper. For 8 items that
 * is 15-25 minutes in one job.
 *
 * Against the inherited 60s lockDuration, BullMQ reclaims the job as stalled
 * long before it finishes, and after `maxStalledCount` kills it outright with
 * "job stalled more than allowable limit". Observed on production 2026-08-03:
 * three RANKING jobs sat in ASSET_COLLECTION with error_message NULL for hours
 * — alive in the UI, already dead in the queue — and the work restarted from
 * item 1 on every reclaim, re-downloading everything.
 *
 * Same fix and same reasoning as aiGenerationWorkerOptions above.
 */
export const assetCollectionWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 8,
  lockDuration: 1_800_000, // 30 min — outlasts a full RANKING footage+TTS+Whisper pass
  lockRenewTime: 600_000, // 10 min — renew well before the lock expires
};

/**
 * QMS Validation Worker Options
 * - High concurrency (10 concurrent validations)
 * - Lightweight pre-flight checks — fast schema validation, no heavy I/O
 */
export const qmsValidationWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 10,
};

/**
 * Render Heavy Worker Options
 * - Concurrency 1 per worker instance (autoscaler spawns multiple instances)
 * - CPU-bound workload
 * - Extended lock duration (10 min) — autoscaler-managed workers each handle 1 job
 * - Lock renewal every 3 minutes
 */
export const renderHeavyWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 600000, // 10 minutes — each autoscaler worker handles 1 job at a time
  lockRenewTime: 180000, // 3 minutes (renew lock before expiration)
};

/**
 * Garbage Collection Worker Options
 * - Low concurrency (2 cleanup jobs at a time)
 */
export const garbageCollectionWorkerOptions: Omit<WorkerOptions, "connection"> =
  {
    ...baseWorkerOptions,
    concurrency: 2,
  };

/**
 * Scene Analysis Worker Options
 * - Medium concurrency (8 concurrent LLM calls)
 * - I/O bound (Anthropic API calls) — safe to parallelize aggressively
 */
export const sceneAnalysisWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 8,
};

/**
 * Auto-Label Worker Options
 * - Low concurrency (2 — local Ollama, sequential is fine)
 * - I/O bound (HTTP call to localhost)
 */
export const autoLabelWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
};

/**
 * Bundestag Clip Analysis Worker Options
 * - Low concurrency (2 — Whisper transcription is CPU/memory intensive)
 * - Sprint 1 (Bundestag pre-deployment): hardening against OOM during high-volume clip processing
 * - Whisper transcription uses faster-whisper library, consuming ~4-6 GB per concurrent job
 * - Hetzner VPS has 62 GB total RAM shared across all services
 * - Limiting to 2 concurrent ensures safe memory headroom even during concurrent render operations
 * - Extended lock duration (10 min) for slow transcriptions of 10+ minute parliamentary clips
 */
export const bundestagClipAnalysisWorkerOptions: Omit<
  WorkerOptions,
  "connection"
> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 600000, // 10 minutes for Whisper transcription
  lockRenewTime: 180000, // 3 minutes
};

/**
 * Bundestag Render Worker Options
 * - Low concurrency (2 — FFmpeg composition is CPU/memory bound)
 * - Sprint 1 (Bundestag pre-deployment): hardening against OOM during complex video composition
 * - Composing multi-camera parliamentary clips with effects, transitions, overlays is memory-heavy
 * - FFmpeg can consume 8-12 GB per render with complex multi-camera compositions
 * - Limiting to 2 concurrent ensures stable system responsiveness and prevents OOM cascades
 * - Extended lock duration (10 min) covers longest multi-camera render operations
 */
export const bundestagRenderWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 600000, // 10 minutes for FFmpeg rendering
  lockRenewTime: 180000, // 3 minutes
};

/**
 * Bundestag Playbook Generation Worker Options
 * - Low concurrency (1 — LLM inference is resource-intensive and should not be parallel)
 * - Sprint 1 (Bundestag pre-deployment): ensuring complete worker coverage for operational stability
 * - Local LLM or remote LLM inference for generating editing playbooks from analyzed clips
 * - Single concurrent job prevents contention for LLM compute resources and memory
 * - Extended lock duration (5 min) covers complex playbook generation with detailed cut decisions
 */
export const bundestagPlaybookGenerationWorkerOptions: Omit<
  WorkerOptions,
  "connection"
> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 300000, // 5 minutes for complex playbook generation
  lockRenewTime: 120000, // 2 minutes
};

/**
 * Dead Letter Worker Options
 * - No automatic workers (manual inspection only)
 */
export const deadLetterWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  autorun: false,
};

/**
 * Video Stitch Worker Options
 * - Concurrency 1 (fixed, never scales)
 * - CPU-bound workload (FFmpeg normalization + Remotion rendering)
 * - Extended lock duration (20 min) — handles long video stitching jobs
 * - Lock renewal every 5 minutes
 * - Capacity-limited to ensure <50% server resource usage
 */
export const videoStitchWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 1200000, // 20 minutes — handles long stitched videos
  lockRenewTime: 300000, // 5 minutes (renew lock before expiration)
};

/**
 * Clip Ingest Worker Options
 * - Concurrency 3 — I/O-bound (download + scene detection), safe to parallelize
 * - Extended lock duration (35 min) — must outlast the 30 min queue timeout
 * - Lock renewal every 10 minutes
 */
export const clipIngestWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 3,
  lockDuration: 2_100_000, // 35 min — outlasts 30 min job timeout
  lockRenewTime: 600_000, // 10 min
};

/**
 * Clip Label Worker Options
 * - Concurrency 4 — five Gemini Ultra sessions in the self-hosted pool;
 *   four in flight leaves headroom for batch jobs and pool re-warm without
 *   stranding sessions. Per-library soft cap (clip_libraries.labeling_concurrency,
 *   default 4) lets a fragile source library throttle further without
 *   touching this worker config.
 * - Extended lock duration (10 min) — outlasts Gemini pool queue wait
 * - Lock renewal every 2 minutes
 */
export const clipLabelWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 4,
  lockDuration: 600_000, // 10 min — covers pool queue wait + vision call
  lockRenewTime: 120_000, // 2 min
};

/**
 * Clip Label Batch Worker Options
 * - Concurrency 2 — coarse jobs (whole-source batches). Per-library
 *   labeling_concurrency soft cap inside the processor throttles individual
 *   Gemini calls so two batches don't double-saturate the pool.
 * - Very long lock (3 hr) — feature-length film can have 2000+ clips labeled
 *   in sequence. lockRenewTime 10 min keeps the lock alive across the run.
 */
export const clipLabelBatchWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 3 * 60 * 60 * 1000,
  lockRenewTime: 10 * 60 * 1000,
};

/**
 * Clip Embed Worker Options
 * - Concurrency 5 — CPU-bound (BGE-M3), no GPU contention
 * - Standard lock duration (2 min) — each clip embeds in well under 1 min
 */
export const clipEmbedWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 5,
};

/**
 * Image Ingest Worker Options
 * - Concurrency 6 — pure I/O (HTTP download, hash, ffmpeg pHash extraction).
 * - Lock 10 min — covers slow stock-photo APIs and large source files.
 */
export const imageIngestWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 6,
  lockDuration: 600_000,
  lockRenewTime: 120_000,
};

/**
 * Image Label Worker Options
 * - Concurrency 4 — same Gemini pool as clip-label; per-library soft cap
 *   in clip_libraries.labeling_concurrency further throttles per library.
 * - Lock 10 min — covers pool queue wait + single-frame Gemini call.
 */
export const imageLabelWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 4,
  lockDuration: 600_000,
  lockRenewTime: 120_000,
};

/**
 * Image Embed Worker Options
 * - Concurrency 5 — CPU-bound BGE-M3 sidecar call.
 */
export const imageEmbedWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 5,
};

/**
 * Clip Selection Worker Options
 * - Concurrency 2 — network I/O bound (LLM API + vector DB batch retrieval)
 * - Extended lock duration (12 min) — outlasts 10 min selection timeout
 * - Lock renewal every 3 minutes
 */
export const clipSelectionWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 720_000, // 12 min — outlasts 10 min selection timeout
  lockRenewTime: 180_000, // 3 min
};

/**
 * Clip Retag Worker Options
 * - Concurrency 5 — LLM API calls (Claude Haiku), network I/O bound
 * - Standard lock duration — each retag completes in well under 2 min
 */
export const clipRetagWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 5,
};

/**
 * Clip Extract Worker Options
 * - Concurrency 2 — FFmpeg stream-copy is I/O-bound not CPU-bound
 * - Extended lock (2 hr) to cover full library backfill in one job
 * - Lock renewal every 10 min
 */
export const clipExtractWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 7_200_000, // 2 hr — handles 2000+ clip backfill
  lockRenewTime: 600_000, // 10 min
};

/**
 * Drama TTS Worker Options
 * - ElevenLabs TTS, chunked calls + ffmpeg concat. Concurrency 2.
 * - Extended lock (30 min) to cover multi-chunk TTS generation.
 */
export const dramaTTSWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000,
};

/**
 * Drama Transcribe Worker Options
 * - Local Whisper transcription. Concurrency 2.
 * - Extended lock (30 min) for large audio files.
 */
export const dramaTranscribeWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000,
};

/**
 * Drama Prompt Gen Worker Options
 * - Gemini pool prompt generation per sentence batch. Concurrency 2 — network I/O bound.
 */
export const dramaPromptGenWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
};

/**
 * Drama Image Gen Worker Options
 * - Nano Banana parallel image generation. Concurrency 2.
 * - Extended lock (2 hr) — many sequential API calls per job.
 */
export const dramaImageGenWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 2 * 60 * 60 * 1000,
};

/**
 * Drama Video Gen Worker Options
 * - Veo i2v per clip, sequential polling. Concurrency 1.
 * - Extended lock (4 hr) — many clips × ~2 min each.
 */
export const dramaVideoGenWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 4 * 60 * 60 * 1000,
};

/**
 * Drama Assemble Worker Options
 * - FFmpeg Ken Burns or video concat. Concurrency 1.
 * - Extended lock (3 hr) — long-form video render.
 */
export const dramaAssembleWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 3 * 60 * 60 * 1000,
};

/**
 * Drama QC Worker Options
 * - pyscenedetect + LUFS quality checks. Concurrency 2.
 * - Extended lock (30 min) for large video analysis.
 */
export const dramaQCWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000,
};

/**
 * Drama Thumbnail Worker Options
 * - Nano Banana single image generation. Concurrency 4 — fast, network I/O bound.
 */
export const dramaThumbnailWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 4,
};

/** Global Thumbnail Worker — single image gen, concurrency 4, network I/O bound. */
export const thumbnailWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 4,
};

/**
 * Stock library generator: one VEO t2v call per job. Up to 50 concurrent
 * submissions but the media-gen gateway enforces 150/hr, so many jobs wait
 * for the rate window. Lock must outlast the full wait+poll cycle:
 * worst case 60 min (rate-limit backoff) + 10 min generation = 70 min.
 * Lock renewal every 10 min keeps the lock alive without thundering-herd
 * renewal traffic.
 */
export const stockLibraryGenWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 50,
  lockDuration: 75 * 60 * 1000, // 75 min — covers rate-limit wait + poll window
  lockRenewTime: 10 * 60 * 1000, // 10 min renewal
};

/**
 * Tutorial Generate Worker Options
 * - LLM script generation + TTS synthesis. Concurrency 4 — network I/O bound.
 * - Extended lock (30 min) to cover full TTS generation pipeline.
 */
export const tutorialGenerateWorkerOptions: Omit<WorkerOptions, "connection"> =
  {
    ...baseWorkerOptions,
    concurrency: 4,
    lockDuration: 30 * 60 * 1000,
  };

/**
 * Tutorial Splice Worker Options
 * - FFmpeg mux TTS onto recording. Concurrency 2 — CPU-bound.
 * - Extended lock (30 min) to cover long recording files.
 */
export const tutorialSpliceWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000,
};

/**
 * Tutorial Translate Worker Options
 * - LLM translate + TTS re-synthesis. Concurrency 2 — network I/O bound.
 * - Extended lock (30 min) to cover full TTS generation pipeline.
 */
export const tutorialTranslateWorkerOptions: Omit<WorkerOptions, "connection"> =
  {
    ...baseWorkerOptions,
    concurrency: 2,
    lockDuration: 30 * 60 * 1000,
  };

/**
 * Tutorial Stitch Worker Options
 * - FFmpeg concat demuxer: joins N segment MP4s into one file.
 * - Concurrency 1 (CPU-bound), lock 20 min.
 * - lockRenewTime 5 min to keep the lock alive during long files.
 */
export const tutorialStitchWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 1,
  lockDuration: 20 * 60 * 1000, // 20 min
  lockRenewTime: 5 * 60 * 1000, // 5 min
};

export const reactorDownloadWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000, // 30 min — yt-dlp can be slow
  lockRenewTime: 5 * 60 * 1000,
};

export const reactorTranscribeWorkerOptions: Omit<WorkerOptions, "connection"> =
  {
    ...baseWorkerOptions,
    concurrency: 2,
    lockDuration: 60 * 60 * 1000, // 60 min — long videos
    lockRenewTime: 10 * 60 * 1000,
  };

export const reactorScriptWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 10 * 60 * 1000,
  lockRenewTime: 2 * 60 * 1000,
};

export const reactorTTSWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 30 * 60 * 1000,
  lockRenewTime: 5 * 60 * 1000,
};

export const reactorAssembleWorkerOptions: Omit<WorkerOptions, "connection"> = {
  ...baseWorkerOptions,
  concurrency: 2,
  lockDuration: 10 * 60 * 1000,
  lockRenewTime: 2 * 60 * 1000,
};

/**
 * Get worker options by queue name
 */
export function getWorkerOptions(
  queueName: string,
): Omit<WorkerOptions, "connection"> {
  switch (queueName) {
    case QUEUE_NAMES.INGEST:
      return ingestWorkerOptions;
    case QUEUE_NAMES.AI_GENERATION:
      return aiGenerationWorkerOptions;
    case QUEUE_NAMES.ASSET_COLLECTION:
      return assetCollectionWorkerOptions;
    case QUEUE_NAMES.QMS_VALIDATION:
      return qmsValidationWorkerOptions;
    case QUEUE_NAMES.RENDER_HEAVY:
      return renderHeavyWorkerOptions;
    case QUEUE_NAMES.GARBAGE_COLLECTION:
      return garbageCollectionWorkerOptions;
    case QUEUE_NAMES.SCENE_ANALYSIS:
      return sceneAnalysisWorkerOptions;
    case QUEUE_NAMES.AUTO_LABEL:
      return autoLabelWorkerOptions;
    case QUEUE_NAMES.BUNDESTAG_CLIP_ANALYSIS:
      return bundestagClipAnalysisWorkerOptions;
    case QUEUE_NAMES.BUNDESTAG_PLAYBOOK_GENERATION:
      return bundestagPlaybookGenerationWorkerOptions;
    case QUEUE_NAMES.BUNDESTAG_RENDER:
      return bundestagRenderWorkerOptions;
    case QUEUE_NAMES.DEAD_LETTER:
      return deadLetterWorkerOptions;
    case QUEUE_NAMES.VIDEO_STITCH:
      return videoStitchWorkerOptions;
    case QUEUE_NAMES.CLIP_INGEST:
      return clipIngestWorkerOptions;
    case QUEUE_NAMES.CLIP_LABEL:
      return clipLabelWorkerOptions;
    case QUEUE_NAMES.CLIP_LABEL_BATCH:
      return clipLabelBatchWorkerOptions;
    case QUEUE_NAMES.CLIP_EMBED:
      return clipEmbedWorkerOptions;
    case QUEUE_NAMES.IMAGE_INGEST:
      return imageIngestWorkerOptions;
    case QUEUE_NAMES.IMAGE_LABEL:
      return imageLabelWorkerOptions;
    case QUEUE_NAMES.IMAGE_EMBED:
      return imageEmbedWorkerOptions;
    case QUEUE_NAMES.CLIP_SELECTION:
      return clipSelectionWorkerOptions;
    case QUEUE_NAMES.CLIP_RETAG:
      return clipRetagWorkerOptions;
    case QUEUE_NAMES.CLIP_EXTRACT:
      return clipExtractWorkerOptions;
    case QUEUE_NAMES.DRAMA_TTS:
      return dramaTTSWorkerOptions;
    case QUEUE_NAMES.DRAMA_TRANSCRIBE:
      return dramaTranscribeWorkerOptions;
    case QUEUE_NAMES.DRAMA_PROMPT_GEN:
      return dramaPromptGenWorkerOptions;
    case QUEUE_NAMES.DRAMA_IMAGE_GEN:
      return dramaImageGenWorkerOptions;
    case QUEUE_NAMES.DRAMA_VIDEO_GEN:
      return dramaVideoGenWorkerOptions;
    case QUEUE_NAMES.DRAMA_ASSEMBLE:
      return dramaAssembleWorkerOptions;
    case QUEUE_NAMES.DRAMA_QC:
      return dramaQCWorkerOptions;
    case QUEUE_NAMES.DRAMA_THUMBNAIL:
      return dramaThumbnailWorkerOptions;
    case QUEUE_NAMES.THUMBNAIL:
      return thumbnailWorkerOptions;
    case QUEUE_NAMES.STOCK_LIBRARY_GEN:
      return stockLibraryGenWorkerOptions;
    case QUEUE_NAMES.TUTORIAL_GENERATE:
      return tutorialGenerateWorkerOptions;
    case QUEUE_NAMES.TUTORIAL_SPLICE:
      return tutorialSpliceWorkerOptions;
    case QUEUE_NAMES.TUTORIAL_TRANSLATE:
      return tutorialTranslateWorkerOptions;
    case QUEUE_NAMES.TUTORIAL_STITCH:
      return tutorialStitchWorkerOptions;
    case QUEUE_NAMES.REACTOR_DOWNLOAD:
      return reactorDownloadWorkerOptions;
    case QUEUE_NAMES.REACTOR_TRANSCRIBE:
      return reactorTranscribeWorkerOptions;
    case QUEUE_NAMES.REACTOR_SCRIPT:
      return reactorScriptWorkerOptions;
    case QUEUE_NAMES.REACTOR_TTS:
      return reactorTTSWorkerOptions;
    case QUEUE_NAMES.REACTOR_ASSEMBLE:
      return reactorAssembleWorkerOptions;
    default:
      return baseWorkerOptions;
  }
}
