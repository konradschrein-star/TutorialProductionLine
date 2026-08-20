/**
 * State Transition Rules
 *
 * Single source of truth for all legal job status transitions.
 * The TRANSITION_MAP is declarative, readable, and maintainable.
 *
 * Design principles:
 * - Map-based lookup for O(1) validation
 * - Explicit is better than implicit
 * - Forward progress, rejection loops, failure recovery, pause/resume
 * - Terminal states have minimal or no forward transitions
 */

/**
 * Job Status Type
 * (Copied from @repo/contracts to avoid circular dependency at type level)
 */
type JobStatus =
  | "IDEA_GENERATION"
  | "SCRIPTING"
  | "AWAITING_RESEARCH"
  | "RESEARCH_UPLOADED"
  | "ASSET_COLLECTION"
  | "CLIP_SELECTION"
  | "AWAITING_CLIP_REVIEW"
  | "AWAITING_PRODUCTION_VA"
  | "AWAITING_IMAGE_QC"
  | "AWAITING_VA_REVIEW"
  | "QMS_VALIDATING"
  | "ROUTING_RENDER"
  | "RENDERING_FFMPEG"
  | "RENDERING_REMOTION"
  | "AWAITING_QC"
  | "AWAITING_UPLOADER"
  | "UPLOADING"
  | "PUBLISHED"
  | "PAUSED"
  | "CANCELLED"
  | "FAILED_QMS"
  | "FAILED_CLIP_SELECTION"
  | "FAILED_RENDER"
  | "FAILED_UPLOAD"
  | "FAILED_GENERAL"
  | "FAILED_IRRECOVERABLE"
  | "MARKED_FOR_DELETION"
  | "DELETED"
  | "SPACE_TTS_GENERATING"
  | "SPACE_TRANSCRIBING"
  | "SPACE_PROMPT_GENERATING"
  | "SPACE_IMAGE_GENERATING"
  | "SPACE_VIDEO_GENERATING"
  | "SPACE_ASSEMBLING"
  | "FAILED_SPACE_PIPELINE"
  | "DRAMA_TTS_GENERATING"
  | "DRAMA_TRANSCRIBING"
  | "DRAMA_PROMPT_GENERATING"
  | "DRAMA_IMAGE_GENERATING"
  | "DRAMA_VIDEO_GENERATING"
  | "DRAMA_ASSEMBLING"
  | "DRAMA_QC"
  | "DRAMA_QC_FAILED"
  | "FAILED_DRAMA_PIPELINE"
  | "REACTOR_DOWNLOADING"
  | "REACTOR_TRANSCRIBING"
  | "REACTOR_SCRIPTING"
  | "REACTOR_TTS_GENERATING"
  | "REACTOR_ASSEMBLING"
  | "FAILED_REACTOR_PIPELINE"
  | "TECH_FOOTAGE_COLLECTING"
  | "TECH_FOOTAGE_FAILED";

/**
 * Transition Map
 *
 * Maps each status to its legal next states.
 * Organized by status category for readability.
 */
export const TRANSITION_MAP: Record<JobStatus, JobStatus[]> = {
  // === Forward pipeline ===

  IDEA_GENERATION: [
    "SCRIPTING",
    "REACTOR_DOWNLOADING", // POLITICAL_COMMENTARY_REACTOR bypasses generic SCRIPTING — it has REACTOR_SCRIPTING further along its lane. The ingest processor (apps/worker-orchestrator/src/processors/ingest.ts) dispatches directly to REACTOR_DOWNLOADING once it sees format=POLITICAL_COMMENTARY_REACTOR.
    "PAUSED",
    "FAILED_GENERAL",
    "MARKED_FOR_DELETION",
  ],

  SCRIPTING: [
    "AWAITING_RESEARCH", // Comparison format requires research phase
    "ASSET_COLLECTION", // Skip research for other formats
    "TECH_FOOTAGE_COLLECTING", // Tech Comparison footage collection pipeline entry
    "DRAMA_TTS_GENERATING", // Long Form Drama pipeline entry point
    "REACTOR_DOWNLOADING", // Political Commentary Reactor pipeline entry point
    "PAUSED",
    "FAILED_GENERAL",
    "MARKED_FOR_DELETION",
  ],

  AWAITING_RESEARCH: [
    "RESEARCH_UPLOADED", // Research VA uploads source materials
    "SCRIPTING", // Loop back if research inadequate
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  RESEARCH_UPLOADED: [
    "ASSET_COLLECTION", // Proceed to asset collection after research validated
    "AWAITING_RESEARCH", // Request new research if uploaded materials inadequate
    "PAUSED",
    "FAILED_GENERAL",
    "MARKED_FOR_DELETION",
  ],

  ASSET_COLLECTION: [
    "CLIP_SELECTION", // Clip library enabled for this format
    "AWAITING_PRODUCTION_VA", // Formats requiring VA approval
    "AWAITING_IMAGE_QC", // Image QC enabled in template — VA reviews scene images
    "AWAITING_VA_REVIEW", // RANKING footage pick/trim loop (asset_quality_loop)
    "QMS_VALIDATING", // Fully automated formats
    "PAUSED",
    "FAILED_GENERAL",
    "MARKED_FOR_DELETION",
  ],

  // === Clip library selection ===

  CLIP_SELECTION: [
    "AWAITING_CLIP_REVIEW", // HITL clip review enabled
    "QMS_VALIDATING", // Auto-approved (hitl_clip_review = false)
    "FAILED_CLIP_SELECTION",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  AWAITING_CLIP_REVIEW: [
    "QMS_VALIDATING", // Human approved edit list
    "CLIP_SELECTION", // Human rejected — re-run selection
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === Human-in-the-loop: Image QC ===

  AWAITING_IMAGE_QC: [
    "QMS_VALIDATING", // VA approves images — proceed to render
    "ASSET_COLLECTION", // VA requests full regeneration
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === Human-in-the-loop: VA Review Studio (RANKING footage pick/trim) ===

  AWAITING_VA_REVIEW: [
    "QMS_VALIDATING", // VA submits — all items reviewed, proceed to render
    "ASSET_COLLECTION", // VA requests regen of footage
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === Human-in-the-loop: Production VA ===

  AWAITING_PRODUCTION_VA: [
    "AWAITING_IMAGE_QC", // VA uploads footage, image QC required before render
    "QMS_VALIDATING", // VA approves, move forward (image QC not required)
    "SCRIPTING", // VA rejects script, loop back
    "ASSET_COLLECTION", // VA rejects assets, loop back
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === QMS validation ===

  QMS_VALIDATING: [
    "ROUTING_RENDER", // QMS passed
    "FAILED_QMS", // QMS failed - don't waste compute on bad assets
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === Render routing ===

  ROUTING_RENDER: [
    "RENDERING_FFMPEG", // Lightweight path
    "RENDERING_REMOTION", // Heavyweight path
    "PAUSED",
    "FAILED_GENERAL",
    "MARKED_FOR_DELETION",
  ],

  RENDERING_FFMPEG: [
    "AWAITING_QC",
    "AWAITING_UPLOADER", // skip_final_qc: render goes straight to uploader
    "PAUSED",
    "FAILED_RENDER",
    "MARKED_FOR_DELETION",
  ],

  RENDERING_REMOTION: [
    "AWAITING_QC",
    "AWAITING_UPLOADER", // skip_final_qc: render goes straight to uploader
    "PAUSED",
    "FAILED_RENDER",
    "MARKED_FOR_DELETION",
  ],

  // === Human-in-the-loop: QC review ===

  AWAITING_QC: [
    "AWAITING_UPLOADER", // QC approves
    "ROUTING_RENDER", // QC rejects, re-render
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  // === Human-in-the-loop: Uploader VA ===

  AWAITING_UPLOADER: [
    "UPLOADING", // Uploader VA starts upload
    "AWAITING_QC", // Uploader VA finds issue, send back to QC
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  UPLOADING: ["PUBLISHED", "FAILED_UPLOAD", "PAUSED", "MARKED_FOR_DELETION"],

  // === Terminal states ===

  PUBLISHED: [
    "MARKED_FOR_DELETION", // Only deletion allowed after publishing
  ],

  CANCELLED: [
    "MARKED_FOR_DELETION", // Only deletion allowed after cancellation
  ],

  DELETED: [], // Truly terminal - no further transitions

  // === Operational control ===

  PAUSED: [
    // Resume transitions are dynamic - set by paused_from_status
    // The transition logic handles PAUSED specially
  ],

  // === Failure states ===

  FAILED_CLIP_SELECTION: [
    "CLIP_SELECTION", // Retry clip selection
    "ASSET_COLLECTION", // Regenerate assets and re-select
    "MARKED_FOR_DELETION", // Give up
  ],

  FAILED_QMS: [
    "QMS_VALIDATING", // Retry QMS validation
    "ASSET_COLLECTION", // Regenerate assets
    "MARKED_FOR_DELETION", // Give up
  ],

  FAILED_RENDER: [
    "ROUTING_RENDER", // Retry render (re-route)
    "RENDERING_FFMPEG", // Direct retry (FFmpeg path)
    "RENDERING_REMOTION", // Direct retry (Remotion path)
    "MARKED_FOR_DELETION", // Give up
  ],

  FAILED_UPLOAD: [
    "UPLOADING", // Retry upload
    "MARKED_FOR_DELETION", // Give up
  ],

  FAILED_GENERAL: [
    "IDEA_GENERATION", // Restart pipeline from beginning
    "MARKED_FOR_DELETION", // Give up
  ],

  FAILED_IRRECOVERABLE: [
    "MARKED_FOR_DELETION", // Only deletion allowed - no retry possible
  ],

  // === Deletion ===

  MARKED_FOR_DELETION: [
    "DELETED", // Final deletion after GC worker processes
  ],

  // === SPACE_VIDEO pipeline (retired 2026-07-02) ===
  // Format deleted; no code path creates or advances jobs through these
  // states anymore. Entries kept only so Record<JobStatus, JobStatus[]>
  // stays exhaustive against the historical status enum in @repo/contracts.

  SPACE_TTS_GENERATING: [
    "SPACE_TRANSCRIBING",
    "FAILED_SPACE_PIPELINE",
    "PAUSED",
  ],

  SPACE_TRANSCRIBING: [
    "SPACE_PROMPT_GENERATING",
    "FAILED_SPACE_PIPELINE",
    "PAUSED",
  ],

  SPACE_PROMPT_GENERATING: [
    "SPACE_IMAGE_GENERATING",
    "FAILED_SPACE_PIPELINE",
    "PAUSED",
  ],

  SPACE_IMAGE_GENERATING: [
    "SPACE_VIDEO_GENERATING",
    "FAILED_SPACE_PIPELINE",
    "PAUSED",
  ],

  SPACE_VIDEO_GENERATING: [
    "SPACE_ASSEMBLING",
    "FAILED_SPACE_PIPELINE",
    "PAUSED",
  ],

  SPACE_ASSEMBLING: ["AWAITING_QC", "FAILED_SPACE_PIPELINE", "PAUSED"],

  FAILED_SPACE_PIPELINE: [
    "SPACE_TTS_GENERATING",
    "SPACE_TRANSCRIBING",
    "SPACE_PROMPT_GENERATING",
    "SPACE_IMAGE_GENERATING",
    "SPACE_VIDEO_GENERATING",
    "SPACE_ASSEMBLING",
    "MARKED_FOR_DELETION",
  ],

  // === LONG_FORM_DRAMA pipeline ===

  DRAMA_TTS_GENERATING: [
    "DRAMA_TRANSCRIBING",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_TRANSCRIBING: [
    "DRAMA_PROMPT_GENERATING",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_PROMPT_GENERATING: [
    "DRAMA_IMAGE_GENERATING",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_IMAGE_GENERATING: [
    "DRAMA_VIDEO_GENERATING",
    "DRAMA_ASSEMBLING",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_VIDEO_GENERATING: [
    "DRAMA_ASSEMBLING",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_ASSEMBLING: ["DRAMA_QC", "FAILED_DRAMA_PIPELINE", "PAUSED"],

  DRAMA_QC: [
    "AWAITING_QC",
    "DRAMA_QC_FAILED",
    "FAILED_DRAMA_PIPELINE",
    "PAUSED",
  ],

  DRAMA_QC_FAILED: [
    "DRAMA_TTS_GENERATING",
    "DRAMA_TRANSCRIBING",
    "DRAMA_PROMPT_GENERATING",
    "DRAMA_IMAGE_GENERATING",
    "DRAMA_VIDEO_GENERATING",
    "DRAMA_ASSEMBLING",
    "DRAMA_QC",
    "MARKED_FOR_DELETION",
  ],

  FAILED_DRAMA_PIPELINE: [
    "DRAMA_TTS_GENERATING",
    "DRAMA_TRANSCRIBING",
    "DRAMA_PROMPT_GENERATING",
    "DRAMA_IMAGE_GENERATING",
    "DRAMA_VIDEO_GENERATING",
    "DRAMA_ASSEMBLING",
    "DRAMA_QC",
    "MARKED_FOR_DELETION",
  ],

  // === POLITICAL_COMMENTARY_REACTOR pipeline ===

  REACTOR_DOWNLOADING: [
    "REACTOR_TRANSCRIBING",
    "FAILED_REACTOR_PIPELINE",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  REACTOR_TRANSCRIBING: [
    "REACTOR_SCRIPTING",
    "FAILED_REACTOR_PIPELINE",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  REACTOR_SCRIPTING: [
    "REACTOR_TTS_GENERATING",
    "FAILED_REACTOR_PIPELINE",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  REACTOR_TTS_GENERATING: [
    "REACTOR_ASSEMBLING",
    "FAILED_REACTOR_PIPELINE",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  REACTOR_ASSEMBLING: [
    "ROUTING_RENDER",
    "FAILED_REACTOR_PIPELINE",
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  FAILED_REACTOR_PIPELINE: [
    "REACTOR_DOWNLOADING",
    "REACTOR_TRANSCRIBING",
    "REACTOR_SCRIPTING",
    "REACTOR_TTS_GENERATING",
    "REACTOR_ASSEMBLING",
    "MARKED_FOR_DELETION",
  ],

  // === TECH_COMPARISON footage collection pipeline ===

  TECH_FOOTAGE_COLLECTING: [
    "ASSET_COLLECTION", // Footage fetched successfully — continue to image gen
    "TECH_FOOTAGE_FAILED", // Fetching failed — graceful degradation
    "PAUSED",
    "MARKED_FOR_DELETION",
  ],

  TECH_FOOTAGE_FAILED: [
    "ASSET_COLLECTION", // Graceful: skip footage, continue with motion-graphics only
    "TECH_FOOTAGE_COLLECTING", // Retry footage collection
    "FAILED_GENERAL", // Terminal: graceful degradation path also failed
    "MARKED_FOR_DELETION",
  ],
};

/**
 * Terminal States
 *
 * States where the job lifecycle is complete.
 * No further pipeline progression is possible.
 */
export const TERMINAL_STATES: JobStatus[] = [
  "PUBLISHED",
  "DELETED",
  "CANCELLED",
  "FAILED_IRRECOVERABLE",
];

/**
 * Failure States
 *
 * States representing explicit failures.
 * Most failure states support retry operations, except FAILED_IRRECOVERABLE.
 */
export const FAILURE_STATES: JobStatus[] = [
  "FAILED_CLIP_SELECTION",
  "FAILED_QMS",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
  "FAILED_DRAMA_PIPELINE",
  "DRAMA_QC_FAILED",
  "FAILED_IRRECOVERABLE",
  "FAILED_REACTOR_PIPELINE",
  "TECH_FOOTAGE_FAILED",
];

/**
 * Pausable States
 *
 * States where a job can be paused.
 * Terminal and failure states cannot be paused.
 */
export const PAUSABLE_STATES: JobStatus[] = [
  "IDEA_GENERATION",
  "SCRIPTING",
  "AWAITING_RESEARCH",
  "RESEARCH_UPLOADED",
  "ASSET_COLLECTION",
  "CLIP_SELECTION",
  "AWAITING_CLIP_REVIEW",
  "AWAITING_PRODUCTION_VA",
  "AWAITING_IMAGE_QC",
  "QMS_VALIDATING",
  "ROUTING_RENDER",
  "RENDERING_FFMPEG",
  "RENDERING_REMOTION",
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  "UPLOADING",
  "DRAMA_TTS_GENERATING",
  "DRAMA_TRANSCRIBING",
  "DRAMA_PROMPT_GENERATING",
  "DRAMA_IMAGE_GENERATING",
  "DRAMA_VIDEO_GENERATING",
  "DRAMA_ASSEMBLING",
  "DRAMA_QC",
  "TECH_FOOTAGE_COLLECTING",
];
