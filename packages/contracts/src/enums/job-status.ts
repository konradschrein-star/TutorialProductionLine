import { z } from "zod";

/**
 * Job Status Enum
 *
 * Flat enum representing all possible states in the content job lifecycle.
 * State transition logic lives in packages/domain, not here.
 * Database stores as VARCHAR.
 *
 * Pipeline flow (happy path):
 * IDEA_GENERATION → SCRIPTING → [AWAITING_RESEARCH → RESEARCH_UPLOADED →] ASSET_COLLECTION
 * → AWAITING_PRODUCTION_VA → [AWAITING_IMAGE_QC →] QMS_VALIDATING → ROUTING_RENDER
 * → (RENDERING_FFMPEG | RENDERING_REMOTION) → AWAITING_QC
 * → AWAITING_UPLOADER → UPLOADING → PUBLISHED
 *
 * Operational controls: PAUSED, CANCELLED
 * Failure states: FAILED_QMS, FAILED_RENDER, FAILED_UPLOAD, FAILED_GENERAL, FAILED_IRRECOVERABLE
 * Deletion: MARKED_FOR_DELETION → DELETED
 */
export const JobStatus = z.enum([
  // Pipeline stages (in rough sequential order)
  "IDEA_GENERATION",
  "SCRIPTING",
  "AWAITING_RESEARCH",
  "RESEARCH_UPLOADED",
  "ASSET_COLLECTION",
  "CLIP_SELECTION",
  "AWAITING_CLIP_REVIEW",

  // Human-in-the-loop: Production VA
  "AWAITING_PRODUCTION_VA",

  // Human-in-the-loop: Image QC (VA reviews generated scene images before render)
  // Optional — only triggered when qc_image_review_required is set in template render_config
  "AWAITING_IMAGE_QC",

  // Human-in-the-loop: VA Review Studio (per-item footage pick/trim/upload).
  // RANKING pauses here between ASSET_COLLECTION and QMS_VALIDATING when
  // metadata.ranking.jobMode === "asset_quality_loop".
  "AWAITING_VA_REVIEW",

  // Quality Management System validation
  "QMS_VALIDATING",

  // Render routing and execution
  "ROUTING_RENDER",
  "RENDERING_FFMPEG", // Lightweight FFmpeg render path
  "RENDERING_REMOTION", // Heavyweight React-based render path

  // Human-in-the-loop: QC review
  "AWAITING_QC",

  // Human-in-the-loop: Uploader VA
  "AWAITING_UPLOADER",
  "UPLOADING",

  // Final state
  "PUBLISHED",

  // Operational control states
  "PAUSED",
  "CANCELLED",

  // Failure states (explicit error categorization)
  "FAILED_QMS",
  "FAILED_CLIP_SELECTION",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
  "FAILED_IRRECOVERABLE",

  // Deletion lifecycle
  "MARKED_FOR_DELETION",
  "DELETED",

  // Space Video pipeline stages
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_TTS_GENERATING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_TRANSCRIBING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_PROMPT_GENERATING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_IMAGE_GENERATING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_VIDEO_GENERATING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_ASSEMBLING",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "FAILED_SPACE_PIPELINE",

  // Long Form Drama pipeline stages
  "DRAMA_TTS_GENERATING",
  "DRAMA_TRANSCRIBING",
  "DRAMA_PROMPT_GENERATING",
  "DRAMA_IMAGE_GENERATING",
  "DRAMA_VIDEO_GENERATING",
  "DRAMA_ASSEMBLING",
  "DRAMA_QC",
  "DRAMA_QC_FAILED",
  "FAILED_DRAMA_PIPELINE",

  // Political Commentary Reactor pipeline stages
  "REACTOR_DOWNLOADING",
  "REACTOR_TRANSCRIBING",
  "REACTOR_SCRIPTING",
  "REACTOR_TTS_GENERATING",
  "REACTOR_ASSEMBLING",
  "FAILED_REACTOR_PIPELINE",

  // Tech Comparison footage collection pipeline
  "TECH_FOOTAGE_COLLECTING",
  "TECH_FOOTAGE_FAILED",
]);

export type JobStatus = z.infer<typeof JobStatus>;
