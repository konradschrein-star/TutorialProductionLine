ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "uploader" jsonb;

UPDATE "system_settings"
SET "uploader" = jsonb_build_object(
  'enabled', false,
  'executionMode', 'dry_run',
  'transport', 'youtube_data_api',
  'requireManualRelease', true
)
WHERE "uploader" IS NULL;
