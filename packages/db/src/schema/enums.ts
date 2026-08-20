import { pgEnum } from "drizzle-orm/pg-core";

/**
 * PostgreSQL Enum Definitions
 *
 * These enums provide type safety at the database layer and match
 * the Zod enum definitions in @repo/contracts.
 *
 * Using PostgreSQL native enums over VARCHAR with check constraints
 * provides:
 * - Stronger type safety
 * - Better query performance
 * - Clearer schema documentation
 */

/**
 * Job Status Enum
 *
 * Represents all 23 states in the content job state machine.
 * Organized by category for readability.
 */
export const jobStatusEnum = pgEnum("job_status", [
  // Pipeline stages (automated)
  "IDEA_GENERATION",
  "SCRIPTING",
  "AWAITING_RESEARCH",
  "RESEARCH_UPLOADED",
  "TRANSLATING",
  "ASSET_COLLECTION",
  "CLIP_SELECTION",
  "AWAITING_CLIP_REVIEW",
  "QMS_VALIDATING",
  "ROUTING_RENDER",
  "RENDERING_FFMPEG",
  "RENDERING_REMOTION",

  // Human-in-the-loop stages
  "AWAITING_PRODUCTION_VA",
  "AWAITING_IMAGE_QC",
  "AWAITING_VA_REVIEW",
  "AWAITING_QC",
  "AWAITING_UPLOADER",
  "UPLOADING",

  // Terminal states
  "PUBLISHED",
  "CANCELLED",
  "DELETED",

  // Failure states
  "FAILED_QMS",
  "FAILED_CLIP_SELECTION",
  "FAILED_RENDER",
  "FAILED_UPLOAD",
  "FAILED_GENERAL",
  "FAILED_IRRECOVERABLE",

  // Special states
  "PAUSED",
  "MARKED_FOR_DELETION",

  // Space Video pipeline states
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

  // Long Form Drama pipeline states
  "DRAMA_TTS_GENERATING",
  "DRAMA_TRANSCRIBING",
  "DRAMA_PROMPT_GENERATING",
  "DRAMA_IMAGE_GENERATING",
  "DRAMA_VIDEO_GENERATING",
  "DRAMA_ASSEMBLING",
  "DRAMA_QC",
  "DRAMA_QC_FAILED",
  "FAILED_DRAMA_PIPELINE",

  // Political Commentary Reactor pipeline states
  "REACTOR_DOWNLOADING",
  "REACTOR_TRANSCRIBING",
  "REACTOR_SCRIPTING",
  "REACTOR_TTS_GENERATING",
  "REACTOR_ASSEMBLING",
  "FAILED_REACTOR_PIPELINE",

  // Tech Comparison footage collection states
  "TECH_FOOTAGE_COLLECTING",
  "TECH_FOOTAGE_FAILED",
]);

/**
 * Content Format Enum
 *
 * Defines the content format categories.
 * These are not hardcoded in business logic - they exist as
 * template entries in the Template Registry.
 */
export const contentFormatEnum = pgEnum("content_format", [
  "EXPLAINER",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "NEWS_BROADCAST",
  "DOCUMENTARY",
  /** IDLE since 2026-07-30 — parked, not retired. See FORMAT_LIFECYCLE in @repo/contracts. */
  "POLITICAL_COMMENTARY",
  "TECH_COMPARISON",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "DAY_IN_THE_LIFE",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "HISTORICAL_WHAT_IF",
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "STICKMAN_ANIMATION",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SELF_NARRATED_STORY",
  /** IDLE since 2026-07-30 — parked, not retired. See FORMAT_LIFECYCLE in @repo/contracts. */
  "BUNDESTAG",
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_VIDEO",
  "LONG_FORM_DRAMA",
  "POLITICAL_COMMENTARY_REACTOR",
  "RANKING",
  "BUSINESS_PLAN_HUB",
]);

/**
 * Render Engine Enum
 *
 * Defines which rendering backend to use for composition.
 * - FFMPEG: Lightweight concatenation, static overlays
 * - REMOTION: Complex React-driven dynamic rendering
 */
export const renderEngineEnum = pgEnum("render_engine", ["FFMPEG", "REMOTION"]);

/**
 * Production Version Enum
 *
 * Controls composition complexity during rendering.
 * - V1: Clean Layout (full-screen Ken Burns + avatar PIP + clean captions)
 * - V2: News Broadcast (current complex composition)
 * - V3: Future (SVG animations, real footage)
 */
export const productionVersionEnum = pgEnum("production_version", [
  "V1",
  "V2",
  "V3",
]);

/**
 * Operator Role Enum
 *
 * Defines the five operator roles in the system.
 * Maps to RBAC permissions in the Hub.
 */
export const operatorRoleEnum = pgEnum("operator_role", [
  "ADMIN",
  "MANAGER",
  "PRODUCTION_VA",
  "UPLOADER_VA",
  "VIEWER",
  "DRAMA_OPERATOR",
  "TUTORIAL_VA",
  // Prod already carries INVESTOR ahead of this one (added by hand, never
  // mirrored here — this file and the live enum have disagreed since).
  // TUTORIAL_VISITOR is the read-only sales-demo role; see operator-role.ts.
  "INVESTOR",
  "TUTORIAL_VISITOR",
]);

/**
 * Asset Type Enum
 *
 * Categorizes different types of assets stored in the assets table.
 * Covers style guides, characters, backgrounds, layouts, and media outputs.
 */
export const assetTypeEnum = pgEnum("asset_type", [
  "style_guide",
  "character",
  "character_state",
  "background",
  "layout_reference", // NEW: reference layout for composite multi-image scenes
  "narrator_pose",
  "video/raw-va-footage",
  "video/raw-narrator-footage", // Self-recorded narrator video for SELF_NARRATED_STORY format
  "audio/tts",
  "image/thumbnail",
  "image/broll",
  "video/final-render",
]);

/**
 * Image Generation Mode Enum
 *
 * Determines how images are sourced for a content job.
 * - auto: System automatically generates images via AI (existing behavior)
 * - manual: VA uploads images generated externally (new manual workflow)
 */
export const imageGenerationModeEnum = pgEnum("image_generation_mode", [
  "auto",
  "manual",
]);

/**
 * Bundestag Camera Angle Enum
 *
 * Categorizes camera perspectives in multi-camera Bundestag footage.
 * Used for intelligent camera switching during automated editing.
 */
export const bundestagCameraAngleEnum = pgEnum("bundestag_camera_angle", [
  "wide",
  "closeup",
  "medium",
  "reaction",
  "speaker",
  "audience",
  "overview",
  "unknown",
]);

/**
 * Bundestag Sync Method Enum
 *
 * Tracks how multi-camera clips were synchronized.
 * - audio_correlation: Automatic sync via audio cross-correlation (preferred)
 * - manual: Human-adjusted sync offset
 * - assumed_zero: No sync applied (clips assumed aligned)
 */
export const bundestagSyncMethodEnum = pgEnum("bundestag_sync_method", [
  "audio_correlation",
  "manual",
  "assumed_zero",
]);

/**
 * Bundestag Transcription Quality Grade Enum
 *
 * Quality assessment of Whisper transcription output.
 * Used as a gate before playbook generation.
 */
export const bundestagTranscriptionQualityGradeEnum = pgEnum(
  "bundestag_transcription_quality_grade",
  ["excellent", "good", "acceptable", "poor", "failed"],
);

/**
 * Bundestag Job Status Enum
 *
 * State machine for Bundestag format jobs.
 * Tracks progress from upload through analysis, playbook generation,
 * rendering, and QA.
 */
export const bundestagJobStatusEnum = pgEnum("bundestag_job_status", [
  // Initial states
  "CREATED",
  "PENDING_UPLOAD",

  // Processing states
  "ANALYZING_CLIPS",
  "CLIPS_ANALYZED",
  "GENERATING_PLAYBOOK",
  "PLAYBOOK_GENERATED",
  "RENDERING",
  "RENDERED",

  // QA states
  "AWAITING_QA",
  "QA_APPROVED",
  "QA_REJECTED",

  // Terminal states
  "COMPLETED",
  "FAILED",
  "CANCELLED",

  // Error substates
  "FAILED_CLIP_ANALYSIS",
  "FAILED_PLAYBOOK_GENERATION",
  "FAILED_RENDERING",
  "FAILED_QA",
]);
