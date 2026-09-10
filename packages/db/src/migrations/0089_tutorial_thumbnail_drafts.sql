-- Additive only. Apply before deploying code that creates thumbnail-first
-- locale drafts. Do not remove enum values on rollback; retain draft records.
ALTER TYPE tutorial_job_status ADD VALUE IF NOT EXISTS 'AWAITING_THUMBNAILS';
