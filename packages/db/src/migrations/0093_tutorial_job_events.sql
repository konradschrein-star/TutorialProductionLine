CREATE TABLE IF NOT EXISTS tutorial_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_job_id uuid NOT NULL REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  event_type varchar(64) NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutorial_job_events_job_time_idx ON tutorial_job_events(tutorial_job_id,created_at);

-- Capture durable stage transitions, not every progress tick. Old history is
-- not fabricated. Null actor means system/database transition, not VA activity.
CREATE OR REPLACE FUNCTION record_tutorial_stage_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tutorial_job_events(tutorial_job_id,event_type,payload)
      VALUES(NEW.id,'created',jsonb_build_object('status',NEW.status));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO tutorial_job_events(tutorial_job_id,event_type,payload)
      VALUES(NEW.id,'stage_changed',jsonb_build_object('from',OLD.status,'to',NEW.status));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tutorial_stage_history ON tutorial_jobs;
CREATE TRIGGER tutorial_stage_history AFTER INSERT OR UPDATE OF status ON tutorial_jobs
  FOR EACH ROW EXECUTE FUNCTION record_tutorial_stage_event();
