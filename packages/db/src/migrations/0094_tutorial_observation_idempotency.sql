ALTER TABLE tutorial_job_events ADD COLUMN IF NOT EXISTS event_key varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS tutorial_job_events_external_key_idx
  ON tutorial_job_events(tutorial_job_id,event_type,event_key) WHERE event_key IS NOT NULL;
