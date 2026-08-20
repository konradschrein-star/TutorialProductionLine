-- 0066_tutorial_va_review.sql
--
-- The VA's end-of-day review verdict on a finished tutorial.
--
-- WHY THIS EXISTS
-- ---------------
-- The owner's instruction, verbatim: "At end of day the VA sees all their jobs
-- (this is deliberately motivating — they see how much they produced), and
-- approves or disapproves each. Disapprove deletes the video, including from
-- Drive. Approve or no action = it stays."
--
-- Three things follow from that sentence and are encoded here:
--
--  1. NO ACTION IS A VALID OUTCOME. NULL means "not reviewed", and a NULL
--     review must never block or delete anything. The gate is NON-BLOCKING by
--     design — the VA confirms and moves on, work proceeds in the background.
--     A schema that required a verdict would turn a motivating end-of-day
--     glance into a chore that stalls the pipeline.
--
--  2. 'approved' AND NULL BEHAVE IDENTICALLY as far as the pipeline is
--     concerned. Approval is recorded because the VA wants to see what they
--     got through, not because anything downstream waits on it.
--
--  3. ONLY 'disapproved' DESTROYS ANYTHING, and only because a human said so.
--     Nothing in this system deletes a video on a timer or a heuristic — see
--     `job-auto-delete.ts`, which used to and is the reason that rule is now
--     written down in three places.
--
-- `va_reviewed_by` is who pressed the button, so a disapproval that turns out
-- to be a mistake can be traced to a person and a time rather than argued about.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS va_review_status text,
  ADD COLUMN IF NOT EXISTS va_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS va_reviewed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tutorial_jobs_va_review_status_check'
  ) THEN
    ALTER TABLE tutorial_jobs
      ADD CONSTRAINT tutorial_jobs_va_review_status_check
      CHECK (va_review_status IS NULL OR va_review_status IN ('approved', 'disapproved'));
  END IF;
END $$;

-- The review tab's query is "today's finished jobs", so it reads by date.
CREATE INDEX IF NOT EXISTS idx_tutorial_jobs_completed_at
  ON tutorial_jobs (completed_at DESC)
  WHERE completed_at IS NOT NULL;
