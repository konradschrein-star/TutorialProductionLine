-- Tutorial Studio ship-migration prerequisites.
--
-- The 2026-07-30 Drizzle baseline predates several hand-applied Tutorial
-- Studio migrations.  Production already had those migrations, but a new
-- database created from the baseline did not.  Later ship migrations (most
-- visibly 0096 and 0105) therefore referenced columns that did not exist.
--
-- Keep this migration additive and idempotent.  It intentionally contains no
-- channel/user/job data backfill: replaying bootstrap DDL must never overwrite
-- operator choices on an existing installation.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS accepts_tutorials boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepts_rankings boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_tutorial_channel_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'users'::regclass
       AND conname = 'users_default_tutorial_channel_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_default_tutorial_channel_id_fkey
      FOREIGN KEY (default_tutorial_channel_id)
      REFERENCES channels(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS source_job_id uuid,
  ADD COLUMN IF NOT EXISTS script_structure jsonb,
  ADD COLUMN IF NOT EXISTS reference_transcript_source text,
  ADD COLUMN IF NOT EXISTS reference_transcript_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS tts_provider_used text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS tags jsonb,
  ADD COLUMN IF NOT EXISTS va_review_status text,
  ADD COLUMN IF NOT EXISTS va_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS va_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS output_qa_status text,
  ADD COLUMN IF NOT EXISTS output_qa_detail jsonb,
  ADD COLUMN IF NOT EXISTS output_qa_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'tutorial_jobs'::regclass
       AND conname = 'tutorial_jobs_source_job_id_tutorial_jobs_id_fk'
  ) THEN
    ALTER TABLE tutorial_jobs
      ADD CONSTRAINT tutorial_jobs_source_job_id_tutorial_jobs_id_fk
      FOREIGN KEY (source_job_id)
      REFERENCES tutorial_jobs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'tutorial_jobs'::regclass
       AND conname = 'tutorial_jobs_va_review_status_check'
  ) THEN
    ALTER TABLE tutorial_jobs
      ADD CONSTRAINT tutorial_jobs_va_review_status_check
      CHECK (va_review_status IS NULL OR va_review_status IN ('approved', 'disapproved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'tutorial_jobs'::regclass
       AND conname = 'tutorial_jobs_output_qa_status_check'
  ) THEN
    ALTER TABLE tutorial_jobs
      ADD CONSTRAINT tutorial_jobs_output_qa_status_check
      CHECK (output_qa_status IS NULL OR output_qa_status IN ('passed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tutorial_jobs_source_job_id_idx
  ON tutorial_jobs(source_job_id);
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_completed_at
  ON tutorial_jobs(completed_at DESC)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_output_qa_status
  ON tutorial_jobs(output_qa_status)
  WHERE output_qa_status IS NOT NULL;
