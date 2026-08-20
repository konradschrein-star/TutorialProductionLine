-- 0064_output_qa_gate.sql
--
-- Record the output QA verdict on tutorial jobs so a broken render cannot
-- silently reach Google Drive, and so a human can see WHY one was held.
--
-- WHY THIS EXISTS
-- ---------------
-- On 2026-07-09 this project rendered a video that held ONE STATIC FRAME from
-- 48s to 298s — 84% of its runtime. It rendered without error, transitioned to
-- AWAITING_UPLOADER, and every health signal stayed green. The only reason
-- anyone found out was that a human eventually watched it.
--
-- The new format-agnostic gate (`packages/media-core/src/video-qa-gate.ts`)
-- probes every finished render for a frozen picture, black frames, silent
-- audio and a duration that disagrees with its content. The tutorial lane's
-- last gate before Drive is `tutorial-drive-scanner.ts`, and it needs somewhere
-- to persist that verdict — both to block delivery and to avoid re-probing the
-- same file on every scan pass.
--
-- COLUMN NOTES
-- ------------
--  * `output_qa_status` — NULL means "not yet checked", which is the correct
--    state for the 2,037 tutorials that completed before this gate existed.
--    They are NOT retroactively marked failed; the scanner checks them the
--    next time it considers them. Values: 'passed' | 'failed'.
--  * `output_qa_detail` — the full per-check result, so the review UI can show
--    "frozen for 250s from 48s" rather than a bare boolean. jsonb, not text,
--    because "how many videos failed QA this week" should be a query.
--  * `output_qa_checked_at` — lets the scanner skip re-probing an unchanged
--    file, and lets an operator tell a stale verdict from a fresh one.
--
-- Deliberately NOT a delivery-blocking NOT NULL: a video whose QA has never run
-- must remain deliverable, otherwise adding this migration would strand the
-- entire existing backlog behind a column default.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS output_qa_status text,
  ADD COLUMN IF NOT EXISTS output_qa_detail jsonb,
  ADD COLUMN IF NOT EXISTS output_qa_checked_at timestamptz;

-- Only two verdicts are meaningful; anything else is a bug in the writer.
-- NULL stays legal and means "not checked yet".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tutorial_jobs_output_qa_status_check'
  ) THEN
    ALTER TABLE tutorial_jobs
      ADD CONSTRAINT tutorial_jobs_output_qa_status_check
      CHECK (output_qa_status IS NULL OR output_qa_status IN ('passed', 'failed'));
  END IF;
END $$;

-- The scanner's hot path is "COMPLETED, not delivered, not QA-failed".
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_output_qa_status
  ON tutorial_jobs (output_qa_status)
  WHERE output_qa_status IS NOT NULL;
