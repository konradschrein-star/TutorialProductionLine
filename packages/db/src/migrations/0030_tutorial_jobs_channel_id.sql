-- 0030: tutorial_jobs.channel_id
--
-- Assign tutorial jobs to a channel so the global thumbnail system knows which
-- channel styling/archetypes/persona to use. Nullable + ON DELETE SET NULL for
-- back-compat with existing tutorial rows. Idempotent.

ALTER TABLE "tutorial_jobs"
  ADD COLUMN IF NOT EXISTS "channel_id" uuid;

DO $$ BEGIN
  ALTER TABLE "tutorial_jobs"
    ADD CONSTRAINT "tutorial_jobs_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "tutorial_jobs_channel_id_idx"
  ON "tutorial_jobs" ("channel_id");
