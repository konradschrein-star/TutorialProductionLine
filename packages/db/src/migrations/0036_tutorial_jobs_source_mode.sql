-- 0036: tutorial_jobs.source_mode + reference_url + reference_transcript + language
--
-- Two-mode script source. source_mode = FROM_SCRATCH (research-based write,
-- the default) or TRANSCRIPT_REWRITE (rewrite a reference video's transcript
-- into our own unique script). reference_url/reference_transcript carry the
-- source video link + transcript when rewriting (both nullable; the Keyword
-- Tool auto-fetches the transcript, the standalone CF form pastes it).
-- language is the target spoken language (e.g. "English", "German"); null/empty
-- means English. All idempotent.

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "source_mode" text NOT NULL DEFAULT 'FROM_SCRATCH';

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "reference_url" text;

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "reference_transcript" text;

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "language" text;
