-- 0035: tutorial_jobs.keyword_ref + kt_url
--
-- Video ERP binding: cross-reference a Tutorial Studio job back to the Keyword
-- Tool keyword it was produced from. Both nullable (jobs created directly in
-- Tutorial Studio have neither). keyword_ref holds the KT keyword id (as text);
-- kt_url is a deep link back to the board. Indexed for webhook lookups. Idempotent.

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "keyword_ref" text;

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "kt_url" text;

CREATE INDEX IF NOT EXISTS "tutorial_jobs_keyword_ref_idx"
  ON "tutorial_jobs" ("keyword_ref");
