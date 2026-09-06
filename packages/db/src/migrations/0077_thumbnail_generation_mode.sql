ALTER TABLE "tutorial_settings"
ADD COLUMN IF NOT EXISTS "thumbnail_generation_mode" text DEFAULT 'ai' NOT NULL;

ALTER TABLE "tutorial_settings"
DROP CONSTRAINT IF EXISTS "tutorial_settings_thumbnail_generation_mode_check";

ALTER TABLE "tutorial_settings"
ADD CONSTRAINT "tutorial_settings_thumbnail_generation_mode_check"
CHECK ("thumbnail_generation_mode" IN ('ai', 'manual'));
