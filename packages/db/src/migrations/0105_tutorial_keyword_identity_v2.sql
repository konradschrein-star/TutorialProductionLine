ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_production_run_id uuid,
  ADD COLUMN IF NOT EXISTS external_opportunity_id uuid,
  ADD COLUMN IF NOT EXISTS external_family_id uuid,
  ADD COLUMN IF NOT EXISTS external_route_decision_id uuid,
  ADD COLUMN IF NOT EXISTS external_evidence_id uuid,
  ADD COLUMN IF NOT EXISTS intake_request_id uuid,
  ADD COLUMN IF NOT EXISTS intake_request_hash varchar(64),
  ADD COLUMN IF NOT EXISTS external_route_snapshot jsonb;

-- External identity is an indivisible root-job contract. In particular,
-- translations may not copy it: their identity remains the source_job_id.
ALTER TABLE tutorial_jobs
  DROP CONSTRAINT IF EXISTS tutorial_jobs_external_identity_v2_complete;
ALTER TABLE tutorial_jobs
  ADD CONSTRAINT tutorial_jobs_external_identity_v2_complete CHECK (
        num_nonnulls(
          external_source,
          external_production_run_id,
          external_opportunity_id,
          external_family_id,
          external_route_decision_id,
          external_evidence_id,
          intake_request_id,
          intake_request_hash,
          external_route_snapshot
        ) = 0
        OR (
          source_job_id IS NULL
          AND parent_job_id IS NULL
          AND keyword_ref IS NOT NULL
          AND channel_id IS NOT NULL
          AND language IS NOT NULL
          AND external_source IS NOT NULL
          AND external_source ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
          AND external_production_run_id IS NOT NULL
          AND external_opportunity_id IS NOT NULL
          AND external_family_id IS NOT NULL
          AND external_route_decision_id IS NOT NULL
          AND external_evidence_id IS NOT NULL
          AND intake_request_id IS NOT NULL
          AND intake_request_hash IS NOT NULL
          AND intake_request_hash ~ '^[0-9a-f]{64}$'
          AND external_route_snapshot IS NOT NULL
          AND jsonb_typeof(external_route_snapshot) = 'object'
          AND external_route_snapshot->>'schemaVersion' = '2'
          AND external_route_snapshot->>'routeDecisionId' = external_route_decision_id::text
          AND external_route_snapshot->>'channelId' = channel_id::text
          AND external_route_snapshot->>'language' = language
          AND external_route_snapshot->>'format' = mode::text
        )
  ) NOT VALID;
ALTER TABLE tutorial_jobs
  VALIDATE CONSTRAINT tutorial_jobs_external_identity_v2_complete;

CREATE UNIQUE INDEX IF NOT EXISTS tutorial_jobs_external_run_unique
  ON tutorial_jobs(external_source, external_production_run_id)
  WHERE source_job_id IS NULL
    AND parent_job_id IS NULL
    AND external_source IS NOT NULL
    AND external_production_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tutorial_jobs_intake_request_unique
  ON tutorial_jobs(external_source, intake_request_id)
  WHERE source_job_id IS NULL
    AND parent_job_id IS NULL
    AND external_source IS NOT NULL
    AND intake_request_id IS NOT NULL;

-- Durable PostgreSQL -> BullMQ hand-off. The HTTP process performs no Redis
-- write for v2; the orchestrator leases this record and publishes the stable
-- BullMQ id. A crash after publish is safe because the id is reusable.
CREATE TABLE IF NOT EXISTS tutorial_generation_outbox (
  tutorial_job_id uuid PRIMARY KEY REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'script' CHECK (stage = 'script'),
  bull_job_id text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutorial_generation_outbox_pending
  ON tutorial_generation_outbox(available_at, tutorial_job_id)
  WHERE dispatched_at IS NULL;

CREATE OR REPLACE FUNCTION enqueue_tutorial_generation_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_job_id IS NULL AND NEW.parent_job_id IS NULL AND NEW.external_production_run_id IS NOT NULL THEN
    INSERT INTO tutorial_generation_outbox(tutorial_job_id, stage, bull_job_id)
    VALUES(NEW.id, 'script', 'tutorial-script-' || NEW.id::text)
    ON CONFLICT (tutorial_job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tutorial_generation_dispatch ON tutorial_jobs;
CREATE TRIGGER tutorial_generation_dispatch
  AFTER INSERT ON tutorial_jobs
  FOR EACH ROW EXECUTE FUNCTION enqueue_tutorial_generation_dispatch();

-- Idempotent recovery for a partially applied deployment. Only still-QUEUED
-- v2 roots need a script dispatch; later status is proof that work ran.
INSERT INTO tutorial_generation_outbox(tutorial_job_id, stage, bull_job_id)
SELECT id, 'script', 'tutorial-script-' || id::text
FROM tutorial_jobs
WHERE source_job_id IS NULL
  AND parent_job_id IS NULL
  AND external_production_run_id IS NOT NULL
  AND status = 'QUEUED'
ON CONFLICT (tutorial_job_id) DO NOTHING;

-- Upgrade the transactional status envelope without rewriting historical
-- events. V1 rows retain their exact old field names and UPLOADED milestone.
-- V2 rows carry the namespaced identity needed to bind a callback before the
-- create HTTP acknowledgement reaches the Keyword Tool.
CREATE OR REPLACE FUNCTION enqueue_tutorial_keyword_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seq integer; milestone text; envelope jsonb;
BEGIN
  IF NEW.source_job_id IS NOT NULL OR NEW.parent_job_id IS NOT NULL OR NEW.keyword_ref IS NULL OR NEW.keyword_ref LIKE 'seed:%' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.upload_verified_at IS NOT DISTINCT FROM OLD.upload_verified_at THEN RETURN NEW; END IF;
  END IF;
  SELECT COALESCE(MAX(event_sequence), 0) + 1 INTO seq FROM tutorial_keyword_outbox WHERE tutorial_job_id = NEW.id;

  IF NEW.external_production_run_id IS NULL THEN
    milestone := CASE WHEN NEW.upload_verified_at IS NOT NULL THEN 'UPLOADED' ELSE NEW.status::text END;
    envelope := jsonb_build_object(
      'keyword_ref', NEW.keyword_ref,
      'forge_job_id', NEW.id,
      'status', milestone,
      'title', NEW.title,
      'updated_at', now(),
      'event_sequence', seq,
      'dedup_key', NEW.id::text || ':' || seq::text
    );
  ELSE
    milestone := CASE WHEN NEW.upload_verified_at IS NOT NULL THEN 'DRIVE_VERIFIED' ELSE NEW.status::text END;
    envelope := jsonb_build_object(
      'schema_version', 2,
      'keyword_ref', NEW.keyword_ref,
      'forge_job_id', NEW.id,
      'status', milestone,
      'title', NEW.title,
      'occurred_at', now(),
      'event_sequence', seq,
      'dedup_key', NEW.id::text || ':' || seq::text,
      'external_source', NEW.external_source,
      'request_id', NEW.intake_request_id,
      'production_run_id', NEW.external_production_run_id,
      'opportunity_id', NEW.external_opportunity_id,
      'family_id', NEW.external_family_id,
      'evidence_id', NEW.external_evidence_id,
      'route_decision_id', NEW.external_route_decision_id,
      'channel_id', NEW.channel_id,
      'language', NEW.language,
      'format', NEW.mode::text,
      'route', NEW.external_route_snapshot
    );
  END IF;

  INSERT INTO tutorial_keyword_outbox(tutorial_job_id,event_sequence,payload)
  VALUES(NEW.id, seq, envelope);
  RETURN NEW;
END $$;
