-- 0053: storage_artifacts v2 + daily byte budget.
--
-- Builds on 0041 (storage_artifacts). Widens the artefact set from 3 to 6
-- (adds transcript, subtitles, raw_recording), lets a storage row belong to a
-- tutorial job or a Clip Forge variant (not just a content job), adds language
-- variant support, post-upload MD5 verification, and a per-day upload budget.
--
-- The binding Drive limit is 750 GB UPLOADED PER DAY per account — a volume
-- limit, not a request limit. storage_daily_usage is how we stay under it
-- visibly instead of hitting the cliff.
--
-- Hand-written (drizzle-kit generate is broken in this repo). All statements
-- idempotent — safe to re-run.

-- 1. job_id can now reference three different owner tables (content_jobs,
--    tutorial_jobs, or a clip-forge variant), so the content_jobs FK has to
--    go. owner_kind records which table each row points at.
ALTER TABLE "storage_artifacts"
  DROP CONSTRAINT IF EXISTS "storage_artifacts_job_id_content_jobs_id_fk";
ALTER TABLE "storage_artifacts"
  DROP CONSTRAINT IF EXISTS "storage_artifacts_job_id_fkey";

ALTER TABLE "storage_artifacts"
  ADD COLUMN IF NOT EXISTS "owner_kind" text NOT NULL DEFAULT 'content_job';

-- 2. New columns for language variants + checksum verification.
ALTER TABLE "storage_artifacts"
  ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "storage_artifacts"
  ADD COLUMN IF NOT EXISTS "source_job_id" uuid;
ALTER TABLE "storage_artifacts"
  ADD COLUMN IF NOT EXISTS "drive_md5" text;
ALTER TABLE "storage_artifacts"
  ADD COLUMN IF NOT EXISTS "verified_at" timestamptz;

-- 3. Widen the kind CHECK to the 6-member union. Drop the old constraint
--    (whatever it was named) and re-add the widened one.
ALTER TABLE "storage_artifacts"
  DROP CONSTRAINT IF EXISTS "storage_artifacts_kind_check";
ALTER TABLE "storage_artifacts"
  ADD CONSTRAINT "storage_artifacts_kind_check"
  CHECK ("kind" IN (
    'final_video', 'thumbnail', 'metadata',
    'transcript', 'subtitles', 'raw_recording'
  ));

-- 4. owner_kind CHECK.
ALTER TABLE "storage_artifacts"
  DROP CONSTRAINT IF EXISTS "storage_artifacts_owner_kind_check";
ALTER TABLE "storage_artifacts"
  ADD CONSTRAINT "storage_artifacts_owner_kind_check"
  CHECK ("owner_kind" IN ('content_job', 'tutorial_job', 'clip_variant'));

-- 5. Per-day upload budget accounting. Keyed on UTC date, shared across all
--    subsystems (one Drive account, one 750 GB/day ceiling).
CREATE TABLE IF NOT EXISTS "storage_daily_usage" (
  "usage_date"     date PRIMARY KEY,
  "bytes_uploaded" bigint NOT NULL DEFAULT 0,
  "requests"       integer NOT NULL DEFAULT 0,
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
