-- 0085: Durable Tutorial Studio -> uploader job projection and immutable receipt
-- journal. The actual exchange remains provider-neutral JSON transported via
-- app-owned Google Drive folders; neither product reads the other's database.

CREATE TABLE IF NOT EXISTS tutorial_upload_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_job_id uuid NOT NULL REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  exchange_job_id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision integer NOT NULL DEFAULT 1,
  idempotency_key varchar(128) NOT NULL,
  manifest_sha256 varchar(64),
  channel_key varchar(64) NOT NULL,
  video_path text NOT NULL,
  thumbnail_id uuid NOT NULL REFERENCES thumbnails(id) ON DELETE RESTRICT,
  thumbnail_path text NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'requested',
  attributes jsonb NOT NULL,
  manifest jsonb,
  drive_folder_id text,
  latest_sequence integer NOT NULL DEFAULT 0,
  latest_message text,
  error_code varchar(64),
  error_message text,
  error_retryable boolean,
  youtube_video_id varchar(11),
  youtube_video_url text,
  proof_ref text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tutorial_upload_dispatches_tutorial_job_unique
  ON tutorial_upload_dispatches(tutorial_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS tutorial_upload_dispatches_exchange_job_unique
  ON tutorial_upload_dispatches(exchange_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS tutorial_upload_dispatches_idempotency_unique
  ON tutorial_upload_dispatches(idempotency_key);
CREATE INDEX IF NOT EXISTS tutorial_upload_dispatches_state_idx
  ON tutorial_upload_dispatches(state);

CREATE TABLE IF NOT EXISTS tutorial_upload_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES tutorial_upload_dispatches(id) ON DELETE CASCADE,
  exchange_job_id uuid NOT NULL,
  revision integer NOT NULL,
  sequence integer NOT NULL,
  state varchar(32) NOT NULL,
  progress double precision NOT NULL,
  message text NOT NULL,
  result jsonb,
  error jsonb,
  raw_receipt jsonb NOT NULL,
  receipt_sha256 varchar(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tutorial_upload_receipts_identity_sequence_unique
  ON tutorial_upload_receipts(exchange_job_id, revision, sequence);
CREATE INDEX IF NOT EXISTS tutorial_upload_receipts_dispatch_idx
  ON tutorial_upload_receipts(dispatch_id);
