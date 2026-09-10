import { pgEnum } from "drizzle-orm/pg-core";

export const tutorialJobStatusEnum = pgEnum("tutorial_job_status", [
  "QUEUED",
  "AWAITING_THUMBNAILS",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "SPLICING",
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
  "AWAITING_RECORDINGS",
  "RECORDED",
  "READY_TO_STITCH",
  "SENT_TO_STITCHER",
]);

export const tutorialModeEnum = pgEnum("tutorial_mode", [
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
  "LONG_FORM",
  // Adaptive sub-3-minute modes: length tracks the reference video's runtime.
  // SHORT_MATCH mirrors it; SHORT_PLUS runs ~15% longer, on examples. Added
  // 2026-08-24 via migration 0074 (ALTER TYPE ... ADD VALUE).
  "SHORT_MATCH",
  "SHORT_PLUS",
]);

export const tutorialPromptCategoryEnum = pgEnum("tutorial_prompt_category", [
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
  "LONG_FORM",
  "SHORT_MATCH",
  "SHORT_PLUS",
]);

// capability identifies WHAT kind of key this is (LLM vs TTS).
// The specific provider is stored in the encrypted_secrets.provider text column.
export const secretCapabilityEnum = pgEnum("secret_capability", ["LLM", "TTS"]);
