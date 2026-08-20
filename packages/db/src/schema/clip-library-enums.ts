import { pgEnum } from "drizzle-orm/pg-core";

export const clipIngestStatusEnum = pgEnum("clip_ingest_status", [
  "pending",
  "downloading",
  "download_failed",
  "processing",
  "processing_failed",
  "labeling",
  "labeling_failed",
  "embedding",
  "embedding_failed",
  "ready",
  "archived",
]);

export const clipReviewStatusEnum = pgEnum("clip_review_status", [
  "pending",
  "approved",
  "edited",
  "flagged",
  "skipped",
]);

// Unified audio taxonomy — matches VLM prompt, BEATs mapper, playbook avoid_audio_classes
export const clipAudioClassEnum = pgEnum("clip_audio_class", [
  "dialogue",
  "music_only",
  "speech_over_music",
  "action_sfx",
  "ambient",
  "silence",
]);

export const clipShotScaleEnum = pgEnum("clip_shot_scale", [
  "extreme_close",
  "close",
  "medium",
  "wide",
  "extreme_wide",
  "over_shoulder",
  "pov",
  "aerial",
  "unknown",
]);

// State machine for idempotent retries — resume failed label jobs without repeating completed steps
export const clipLabelingStepEnum = pgEnum("clip_labeling_step", [
  "vlm",
  "whisper",
  "face",
  "audio",
  "done",
]);

// inline = seek into source video at render time (saves storage)
// materialized = extract per-clip MP4 to object storage (DEPRECATED — kept for back-compat reads)
export const clipStorageStrategyEnum = pgEnum("clip_storage_strategy", [
  "inline",
  "materialized",
]);

// Source material type. Drives clip-selection priority and Vidrush-style filters.
// Star Wars-era values (footage_movie, footage_clone_wars, footage_animation, footage_comic)
// stay for back-compat; new ingest paths use the explicit footage_* taxonomy below.
export const clipTypeEnum = pgEnum("clip_type", [
  // Legacy Star Wars taxonomy (back-compat)
  "text_on_screen",
  "footage_movie",
  "footage_clone_wars",
  "footage_animation",
  "footage_comic",
  "ai_generated",
  "unknown",
  // Global taxonomy (added 2026-06-05)
  "footage_real", // live-action real-world (Vidrush bucket)
  "footage_news",
  "footage_documentary",
  "footage_stock", // Pexels / Pixabay / Storyblocks
  "footage_animation_2d",
  "footage_animation_3d",
  "footage_vfx_heavy", // live-action + CGI (Marvel, late-era SW)
  "footage_archival", // pre-2000, black & white, historical
  "screen_recording",
]);

// What kind of upstream the source video came from. Drives ref_base composition.
export const sourceKindEnum = pgEnum("source_kind", [
  "movie",
  "series",
  "youtube",
  "stock",
  "upload",
  "other",
]);

// Where the re-encoded source MP4 + MP3 sidecar physically live. Lets the
// orchestrator stay on the VPS while bytes move to a home NAS later.
export const storageBackendEnum = pgEnum("storage_backend", [
  "local",
  "nas",
  "s3",
]);
