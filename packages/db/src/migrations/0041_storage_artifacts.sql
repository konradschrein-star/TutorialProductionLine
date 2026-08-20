-- 0041: storage_artifacts — links finished job deliverables to their storage
--       locations (VPS primary + optional Google Drive secondary).
--
-- Scope note: this table is for FINISHED PRODUCTS ONLY (final video,
-- thumbnail, metadata sidecar). Temp/intermediate files are never recorded
-- here and are never pushed to Drive.
--
-- The VPS copy stays authoritative. Nothing in this subsystem moves or
-- deletes anything on the VPS — a Drive upload is a copy.
--
-- Idempotency: the UNIQUE index on (job_id, kind) means an artefact has
-- exactly one storage row; re-running an upload updates it in place instead
-- of creating a duplicate Drive file.
--
-- All statements idempotent.

CREATE TABLE IF NOT EXISTS "storage_artifacts" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "job_id"                uuid NOT NULL
                            REFERENCES "content_jobs"("id") ON DELETE CASCADE,
  "channel_id"            uuid
                            REFERENCES "channels"("id") ON DELETE SET NULL,

  -- 'final_video' | 'thumbnail' | 'metadata'
  "kind"                  text NOT NULL,

  -- local (primary) copy
  "filename"              text NOT NULL,
  "vps_path"              text NOT NULL,
  "bytes"                 bigint,
  "checksum_sha256"       text,

  -- Google Drive (secondary) copy
  "drive_file_id"         text,
  "drive_web_link"        text,
  "drive_folder_id"       text,
  "drive_folder_path"     text,

  -- upload lifecycle: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped'
  "state"                 text NOT NULL DEFAULT 'pending',
  "attempts"              integer NOT NULL DEFAULT 0,
  "error_kind"            text,
  "error_message"         text,

  -- resumable-upload bookkeeping (survives a worker restart)
  "resumable_session_uri" text,
  "bytes_uploaded"        bigint NOT NULL DEFAULT 0,

  "first_enqueued_at"     timestamptz,
  "upload_started_at"     timestamptz,
  "uploaded_at"           timestamptz,
  "last_attempt_at"       timestamptz,

  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_artifacts_job_kind_uniq"
  ON "storage_artifacts" ("job_id", "kind");

CREATE INDEX IF NOT EXISTS "storage_artifacts_state_idx"
  ON "storage_artifacts" ("state");

CREATE INDEX IF NOT EXISTS "storage_artifacts_job_idx"
  ON "storage_artifacts" ("job_id");

CREATE INDEX IF NOT EXISTS "storage_artifacts_drive_file_idx"
  ON "storage_artifacts" ("drive_file_id");

-- Guard rails: keep the enum-ish text columns honest without a real pg enum
-- (pg enums are painful to extend; text + CHECK matches the rest of this repo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_artifacts_kind_check'
  ) THEN
    ALTER TABLE "storage_artifacts"
      ADD CONSTRAINT "storage_artifacts_kind_check"
      CHECK ("kind" IN ('final_video', 'thumbnail', 'metadata'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_artifacts_state_check'
  ) THEN
    ALTER TABLE "storage_artifacts"
      ADD CONSTRAINT "storage_artifacts_state_check"
      CHECK ("state" IN ('pending', 'uploading', 'uploaded', 'failed', 'skipped'));
  END IF;
END $$;
