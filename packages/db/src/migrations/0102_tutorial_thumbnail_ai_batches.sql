CREATE TABLE IF NOT EXISTS tutorial_thumbnail_ai_batches (
  job_id uuid NOT NULL REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_digest text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, request_id)
);
