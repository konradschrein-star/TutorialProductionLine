-- Global Subtitle System v2: schema/assignments/fonts extensions.
-- Hand-written (drizzle journal stale at 0012 in this repo — see project memory).
-- Spec: docs/superpowers/specs/2026-07-26-global-subtitle-system-design.md §2.

-- 2.1 subtitle_presets
ALTER TABLE "subtitle_presets" ADD COLUMN IF NOT EXISTS "schema_version" integer NOT NULL DEFAULT 2;
ALTER TABLE "subtitle_presets" ADD COLUMN IF NOT EXISTS "sort_order" integer;
ALTER TABLE "subtitle_presets" ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE "subtitle_presets" ADD COLUMN IF NOT EXISTS "thumbnail_key" text;

-- 2.2 subtitle_preset_assignments
ALTER TABLE "subtitle_preset_assignments" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

-- 2.3 subtitle_fonts
ALTER TABLE "subtitle_fonts" ADD COLUMN IF NOT EXISTS "family" text;
ALTER TABLE "subtitle_fonts" ADD COLUMN IF NOT EXISTS "weights" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "subtitle_fonts" ADD COLUMN IF NOT EXISTS "is_builtin" boolean NOT NULL DEFAULT false;
ALTER TABLE "subtitle_fonts" ADD COLUMN IF NOT EXISTS "preview_text" text;
ALTER TABLE "subtitle_fonts" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'upload';

-- Backfill family from name for existing rows, then enforce NOT NULL.
UPDATE "subtitle_fonts" SET "family" = "name" WHERE "family" IS NULL;
ALTER TABLE "subtitle_fonts" ALTER COLUMN "family" SET NOT NULL;
