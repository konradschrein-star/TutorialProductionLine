CREATE TABLE IF NOT EXISTS tutorial_keyword_outbox (
  id bigserial PRIMARY KEY,
  tutorial_job_id uuid NOT NULL REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  event_sequence integer NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tutorial_job_id, event_sequence)
);
CREATE INDEX IF NOT EXISTS tutorial_keyword_outbox_pending ON tutorial_keyword_outbox(available_at, id) WHERE delivered_at IS NULL;
CREATE OR REPLACE FUNCTION enqueue_tutorial_keyword_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seq integer; milestone text;
BEGIN
  IF NEW.source_job_id IS NOT NULL OR NEW.keyword_ref IS NULL OR NEW.keyword_ref LIKE 'seed:%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.upload_verified_at IS NOT DISTINCT FROM OLD.upload_verified_at THEN RETURN NEW; END IF;
  END IF;
  SELECT COALESCE(MAX(event_sequence), 0) + 1 INTO seq FROM tutorial_keyword_outbox WHERE tutorial_job_id = NEW.id;
  milestone := CASE WHEN NEW.upload_verified_at IS NOT NULL THEN 'UPLOADED' ELSE NEW.status::text END;
  INSERT INTO tutorial_keyword_outbox(tutorial_job_id,event_sequence,payload)
  VALUES(NEW.id,seq,jsonb_build_object('keyword_ref',NEW.keyword_ref,'forge_job_id',NEW.id,'status',milestone,'title',NEW.title,'updated_at',now(),'event_sequence',seq,'dedup_key',NEW.id::text || ':' || seq::text));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tutorial_keyword_milestone ON tutorial_jobs;
CREATE TRIGGER tutorial_keyword_milestone AFTER INSERT OR UPDATE OF status,upload_verified_at ON tutorial_jobs FOR EACH ROW EXECUTE FUNCTION enqueue_tutorial_keyword_milestone();
-- No fabricated history/backfill. The outbox is transactional even while the
-- optional Keyword Tool is offline. Migration must precede new application code.
