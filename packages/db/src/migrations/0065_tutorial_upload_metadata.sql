-- 0065_tutorial_upload_metadata.sql
--
-- Give tutorials a description and tags, and add an `upload_sheet` artifact
-- kind, so a VA opening Google Drive has everything needed to publish WITHOUT
-- opening the app.
--
-- WHY THIS EXISTS
-- ---------------
-- Today a VA who opens a finished tutorial's Drive folder finds the video, the
-- raw recording, a transcript — and a LOWERCASE SLUG as the only title. There
-- is no description and no tags anywhere in the schema: `content_jobs` has
-- `description` and `generated_tags`, `tutorial_jobs` has neither, and the
-- YouTube metadata generator (`youtube-metadata/`) is wired exclusively to
-- content jobs. So "open Drive and upload" was not an achievable instruction —
-- the VA had to come back into the app for the title alone.
--
-- COLUMNS
-- -------
--  * `description` — the YouTube description. NULL means "not generated",
--    which the upload sheet states plainly rather than papering over. We never
--    fabricate a description; an empty one is a visible gap, an invented one is
--    a silent wrong answer that gets published.
--  * `tags` — jsonb array of strings, mirroring `content_jobs.generated_tags`
--    so both lanes can be read the same way.
--
-- ARTIFACT KIND
-- -------------
-- `storage_artifacts.kind` is text + a CHECK constraint, NOT a postgres enum
-- (deliberate — see 0041_storage_artifacts.sql:71-73). Adding a value is
-- therefore a constraint swap and carries none of the `ALTER TYPE ... ADD
-- VALUE` transaction hazards.
--
-- `upload_sheet` is the plain-text upload.txt written into each leaf folder:
-- properly-cased title, description, tags, channel. Plain text on purpose — the
-- VA copy-pastes out of it, and a JSON sidecar is for machines.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS tags jsonb;

-- Widen the artifact-kind check to admit 'upload_sheet'.
ALTER TABLE storage_artifacts
  DROP CONSTRAINT IF EXISTS storage_artifacts_kind_check;

ALTER TABLE storage_artifacts
  ADD CONSTRAINT storage_artifacts_kind_check
  CHECK (
    "kind" IN (
      'final_video',
      'thumbnail',
      'metadata',
      'transcript',
      'subtitles',
      'raw_recording',
      'upload_sheet'
    )
  );
