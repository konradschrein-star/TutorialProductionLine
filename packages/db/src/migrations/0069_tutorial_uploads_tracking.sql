-- Migration 0069_tutorial_uploads_tracking.sql
-- Add upload status tracking columns for manual YouTube uploaders

ALTER TABLE tutorial_jobs ADD COLUMN IF NOT EXISTS is_uploaded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tutorial_jobs ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE tutorial_jobs ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
ALTER TABLE tutorial_jobs ADD COLUMN IF NOT EXISTS youtube_upload_url TEXT;

CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_is_uploaded ON tutorial_jobs (is_uploaded);
