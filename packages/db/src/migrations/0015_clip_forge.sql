-- Clip Forge — 9:16 short-form clipping engine.
-- Hand-written migration (drizzle-kit had unrelated rename conflicts in the
-- existing schema). Matches packages/db/src/schema/clip-forge*.ts exactly.

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "clip_forge_platform" AS ENUM ('tiktok', 'instagram', 'youtube_shorts');
CREATE TYPE "clip_forge_source_status" AS ENUM ('ingested', 'transcribed', 'extracted', 'duplicate', 'failed');
CREATE TYPE "clip_forge_raw_clip_status" AS ENUM ('detected', 'rendering', 'ready', 'rejected', 'cancelled');
CREATE TYPE "clip_forge_category" AS ENUM ('wisdom', 'funny', 'controversial', 'story', 'educational', 'hot_take', 'hype', 'insight', 'reaction', 'rant', 'wholesome', 'other');
CREATE TYPE "clip_forge_distribution_status" AS ENUM ('pooled', 'assigned', 'rendered', 'qc_pass', 'qc_flag', 'qc_fail', 'queued', 'uploaded', 'live', 'failed', 'skipped', 'cancelled');
CREATE TYPE "clip_forge_qc_result" AS ENUM ('pass', 'flag', 'fail');
CREATE TYPE "clip_forge_error_class" AS ENUM ('transient', 'resource', 'data', 'platform', 'logic');
CREATE TYPE "clip_forge_source_kind" AS ENUM ('youtube_vod', 'twitch_vod', 'podcast_rss', 'manual_upload', 'other');
CREATE TYPE "clip_forge_payout_model" AS ENUM ('per_view', 'per_clip', 'flat');

-- ── cf_personas ─────────────────────────────────────────────────────────────
CREATE TABLE "cf_personas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(120) NOT NULL,
  "rights_confirmed" boolean NOT NULL DEFAULT false,
  "payout_model" "clip_forge_payout_model" NOT NULL DEFAULT 'per_view',
  "payout_rate" real NOT NULL DEFAULT 0,
  "default_style_tokens" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "face_detection_hints" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- ── cf_sources ──────────────────────────────────────────────────────────────
CREATE TABLE "cf_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_id" uuid NOT NULL REFERENCES "cf_personas"("id") ON DELETE CASCADE,
  "external_id" varchar(256) NOT NULL,
  "source_kind" "clip_forge_source_kind" NOT NULL,
  "source_url" text NOT NULL,
  "title" text NOT NULL,
  "duration_sec" real NOT NULL DEFAULT 0,
  "resolution" varchar(32),
  "codec" varchar(64),
  "fps" real,
  "size_bytes" integer,
  "transcript_key" text,
  "word_timings" jsonb DEFAULT '[]'::jsonb,
  "audio_fingerprint" varchar(128),
  "duplicate_of" uuid,
  "status" "clip_forge_source_status" NOT NULL DEFAULT 'ingested',
  "raw_video_deleted" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "cf_sources_persona_external_uidx" ON "cf_sources" ("persona_id", "external_id");
CREATE INDEX "cf_sources_status_idx" ON "cf_sources" ("status");
CREATE INDEX "cf_sources_persona_idx" ON "cf_sources" ("persona_id");

-- ── cf_raw_clips ────────────────────────────────────────────────────────────
CREATE TABLE "cf_raw_clips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id" uuid NOT NULL REFERENCES "cf_sources"("id") ON DELETE CASCADE,
  "persona_id" uuid NOT NULL REFERENCES "cf_personas"("id") ON DELETE CASCADE,
  "start_sec" real NOT NULL,
  "end_sec" real NOT NULL,
  "clip_score" real NOT NULL,
  "score_reason" text NOT NULL DEFAULT '',
  "categories" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "suggested_caption" text,
  "reframe_recipe" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "raw_mp4_key" text,
  "status" "clip_forge_raw_clip_status" NOT NULL DEFAULT 'detected',
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_raw_clips_source_idx" ON "cf_raw_clips" ("source_id");
CREATE INDEX "cf_raw_clips_persona_idx" ON "cf_raw_clips" ("persona_id");
CREATE INDEX "cf_raw_clips_status_idx" ON "cf_raw_clips" ("status");
CREATE INDEX "cf_raw_clips_score_idx" ON "cf_raw_clips" ("clip_score");

-- ── cf_finishing_variants ───────────────────────────────────────────────────
CREATE TABLE "cf_finishing_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raw_clip_id" uuid NOT NULL REFERENCES "cf_raw_clips"("id") ON DELETE CASCADE,
  "platform" "clip_forge_platform" NOT NULL,
  "caption_text" text,
  "subtitle_style" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "duration_delta_sec" real NOT NULL DEFAULT 0,
  "variant_seed" integer NOT NULL,
  "rendered_mp4_key" text,
  "rendered_hash" varchar(64),
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_variants_raw_clip_idx" ON "cf_finishing_variants" ("raw_clip_id");
CREATE INDEX "cf_variants_expires_idx" ON "cf_finishing_variants" ("expires_at");
CREATE INDEX "cf_variants_hash_idx" ON "cf_finishing_variants" ("rendered_hash");

-- ── cf_accounts ─────────────────────────────────────────────────────────────
CREATE TABLE "cf_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_id" uuid NOT NULL REFERENCES "cf_personas"("id") ON DELETE CASCADE,
  "platform" "clip_forge_platform" NOT NULL,
  "handle" varchar(128) NOT NULL,
  "variant_seed" integer NOT NULL,
  "posts_per_day" integer NOT NULL DEFAULT 1,
  "jitter_hours_override" integer,
  "daily_slots" integer NOT NULL DEFAULT 3,
  "niche" "clip_forge_category",
  "category_mix" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "proxy_endpoint" text,
  "browser_profile_id" varchar(128),
  "caption_preset_id" uuid,
  "flagged_at" timestamptz,
  "last_activity_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "cf_accounts_platform_handle_uidx" ON "cf_accounts" ("platform", "handle");
CREATE INDEX "cf_accounts_persona_idx" ON "cf_accounts" ("persona_id");
CREATE INDEX "cf_accounts_active_idx" ON "cf_accounts" ("active");

-- ── cf_caption_presets ──────────────────────────────────────────────────────
CREATE TABLE "cf_caption_presets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(120) NOT NULL,
  "text_color" varchar(16) NOT NULL DEFAULT '#ffffff',
  "highlight_color" varchar(16) NOT NULL DEFAULT '#57a578',
  "all_caps" boolean NOT NULL DEFAULT true,
  "outline" boolean NOT NULL DEFAULT true,
  "font_size" integer NOT NULL DEFAULT 38,
  "position_pct" integer NOT NULL DEFAULT 74,
  "animation" varchar(32) NOT NULL DEFAULT 'word-pop',
  "emoji_set" varchar(32) NOT NULL DEFAULT 'minimal',
  "assigned_personas" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_caption_presets_name_idx" ON "cf_caption_presets" ("name");

-- ── cf_caption_pool ─────────────────────────────────────────────────────────
CREATE TABLE "cf_caption_pool" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_id" uuid NOT NULL REFERENCES "cf_personas"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "category" "clip_forge_category",
  "uses" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_caption_pool_persona_idx" ON "cf_caption_pool" ("persona_id");

-- ── cf_distributions (ledger) ───────────────────────────────────────────────
CREATE TABLE "cf_distributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raw_clip_id" uuid NOT NULL REFERENCES "cf_raw_clips"("id") ON DELETE CASCADE,
  "variant_id" uuid REFERENCES "cf_finishing_variants"("id") ON DELETE SET NULL,
  "account_id" uuid NOT NULL REFERENCES "cf_accounts"("id") ON DELETE CASCADE,
  "platform" "clip_forge_platform" NOT NULL,
  "status" "clip_forge_distribution_status" NOT NULL DEFAULT 'pooled',
  "qc_result" "clip_forge_qc_result",
  "qc_report" jsonb,
  "scheduled_for" timestamptz,
  "uploaded_at" timestamptz,
  "post_url" text,
  "view_count" integer NOT NULL DEFAULT 0,
  "view_history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_error" text,
  "error_class" "clip_forge_error_class",
  "retry_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "cf_distributions_clip_account_uidx" ON "cf_distributions" ("raw_clip_id", "account_id");
CREATE INDEX "cf_distributions_status_idx" ON "cf_distributions" ("status");
CREATE INDEX "cf_distributions_account_idx" ON "cf_distributions" ("account_id");
CREATE INDEX "cf_distributions_scheduled_idx" ON "cf_distributions" ("scheduled_for");

-- ── cf_job_failures (DLQ mirror) ────────────────────────────────────────────
CREATE TABLE "cf_job_failures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" varchar(128) NOT NULL,
  "queue" varchar(80) NOT NULL,
  "error_class" "clip_forge_error_class" NOT NULL DEFAULT 'transient',
  "correlation_id" varchar(128),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_error" text,
  "stacktrace" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_job_failures_queue_idx" ON "cf_job_failures" ("queue");
CREATE INDEX "cf_job_failures_class_idx" ON "cf_job_failures" ("error_class");
CREATE INDEX "cf_job_failures_corr_idx" ON "cf_job_failures" ("correlation_id");

-- ── cf_config (auditable settings snapshot) ─────────────────────────────────
CREATE TABLE "cf_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_id" uuid REFERENCES "cf_personas"("id") ON DELETE CASCADE,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "edited_by" varchar(128),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cf_config_persona_idx" ON "cf_config" ("persona_id");
