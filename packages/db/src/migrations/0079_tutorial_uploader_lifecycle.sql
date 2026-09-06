-- Durable contract between Tutorial Studio and the external uploader.
ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "uploader_status" text,
  ADD COLUMN IF NOT EXISTS "youtube_visibility" text,
  ADD COLUMN IF NOT EXISTS "scheduled_for" timestamptz,
  ADD COLUMN IF NOT EXISTS "youtube_published_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "uploader_job_id" text,
  ADD COLUMN IF NOT EXISTS "uploader_event_id" text,
  ADD COLUMN IF NOT EXISTS "uploader_last_callback_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "upload_verified_at" timestamptz;

ALTER TABLE "tutorial_jobs"
  DROP CONSTRAINT IF EXISTS "tutorial_jobs_uploader_status_check";
ALTER TABLE "tutorial_jobs"
  ADD CONSTRAINT "tutorial_jobs_uploader_status_check"
  CHECK ("uploader_status" IS NULL OR "uploader_status" IN
    ('waiting_to_be_uploaded', 'uploading', 'scheduled', 'uploaded', 'failed'));

ALTER TABLE "tutorial_jobs"
  DROP CONSTRAINT IF EXISTS "tutorial_jobs_youtube_visibility_check";
ALTER TABLE "tutorial_jobs"
  ADD CONSTRAINT "tutorial_jobs_youtube_visibility_check"
  CHECK ("youtube_visibility" IS NULL OR "youtube_visibility" IN
    ('scheduled', 'public', 'private', 'unlisted'));

CREATE INDEX IF NOT EXISTS "tutorial_jobs_uploader_status_idx"
  ON "tutorial_jobs" ("uploader_status");
CREATE UNIQUE INDEX IF NOT EXISTS "tutorial_jobs_uploader_event_id_idx"
  ON "tutorial_jobs" ("uploader_event_id")
  WHERE "uploader_event_id" IS NOT NULL;

-- Existing completed Drive deliveries are ready for the uploader unless an
-- older manual upload receipt already proves they were uploaded.
UPDATE "tutorial_jobs"
SET "uploader_status" = CASE
  WHEN "is_uploaded" = true THEN 'uploaded'
  WHEN "delivered_to_drive" = true AND "status" = 'COMPLETED' THEN 'waiting_to_be_uploaded'
  ELSE NULL
END,
"youtube_visibility" = CASE WHEN "is_uploaded" = true THEN 'public' ELSE NULL END
WHERE "uploader_status" IS NULL;
