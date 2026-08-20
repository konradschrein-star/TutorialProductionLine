-- 0029: Global thumbnail system
--
-- Adds the channel-based, format-agnostic thumbnail engine tables:
--   * thumbnail_archetypes           reusable reference-thumbnail "styles"
--   * channel_thumbnail_archetypes   channel <-> archetype many-to-many
--   * channel_personas               channel host/mascot (reusable beyond thumbnails)
--   * channel_thumbnail_profiles     per-channel thumbnail branding (logo/colors/mode)
--   * thumbnails                     one row per generated image (gallery + history)
--
-- Hand-written to match the repo convention (migrations 0013-0028 are hand-authored;
-- the drizzle-kit journal is stale). Fully idempotent: safe to run against dev/CI/prod
-- whether or not the objects already exist.

-- ── Enums (idempotent) ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "public"."thumbnail_subject_kind" AS ENUM('content_job', 'tutorial_job', 'test');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."thumbnail_status" AS ENUM('pending', 'generating', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."thumbnail_prompt_mode" AS ENUM('programmatic', 'deepseek');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── thumbnail_archetypes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "thumbnail_archetypes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "reference_image_path" text NOT NULL,
  "layout_instructions" text,
  "base_prompt" text,
  "features_logo" boolean DEFAULT false NOT NULL,
  "category" varchar(80) DEFAULT 'General' NOT NULL,
  "formats" text[] DEFAULT '{}' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_thumbnail_archetypes_active"
  ON "thumbnail_archetypes" ("is_active");

-- ── channel_thumbnail_archetypes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "channel_thumbnail_archetypes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "archetype_id" uuid NOT NULL REFERENCES "thumbnail_archetypes"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_thumbnail_archetypes_unique"
  ON "channel_thumbnail_archetypes" ("channel_id", "archetype_id");
CREATE INDEX IF NOT EXISTS "idx_channel_thumbnail_archetypes_channel"
  ON "channel_thumbnail_archetypes" ("channel_id");
CREATE INDEX IF NOT EXISTS "idx_channel_thumbnail_archetypes_archetype"
  ON "channel_thumbnail_archetypes" ("archetype_id");

-- ── channel_personas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "channel_personas" (
  "channel_id" uuid PRIMARY KEY REFERENCES "channels"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "description" text NOT NULL,
  "image_path" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── channel_thumbnail_profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "channel_thumbnail_profiles" (
  "channel_id" uuid PRIMARY KEY REFERENCES "channels"("id") ON DELETE CASCADE,
  "logo_image_path" text,
  "primary_color" varchar(16),
  "secondary_color" varchar(16),
  "default_prompt_mode" "thumbnail_prompt_mode" DEFAULT 'programmatic' NOT NULL,
  "extra_prompt_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── thumbnails ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "thumbnails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_kind" "thumbnail_subject_kind" NOT NULL,
  "subject_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "archetype_id" uuid REFERENCES "thumbnail_archetypes"("id") ON DELETE SET NULL,
  "language" varchar(10) DEFAULT 'en' NOT NULL,
  "prompt_mode" "thumbnail_prompt_mode" NOT NULL,
  "prompt_used" text NOT NULL,
  "reference_paths" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_path" text,
  "provider_used" varchar(32),
  "status" "thumbnail_status" DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "is_selected" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_thumbnails_subject"
  ON "thumbnails" ("subject_kind", "subject_id");
CREATE INDEX IF NOT EXISTS "idx_thumbnails_channel_archetype"
  ON "thumbnails" ("channel_id", "archetype_id", "created_at");
