CREATE TABLE IF NOT EXISTS tutorial_thumbnail_fanout (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_job_id uuid NOT NULL REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
 source_thumbnail_id uuid NOT NULL REFERENCES thumbnails(id) ON DELETE RESTRICT,
 approval_revision text NOT NULL,
 source_path text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_size integer NOT NULL CHECK(source_size > 0 AND source_size <= 33554432),
 target_language text NOT NULL CHECK(target_language ~ '^[a-z]{2}$' AND target_language <> 'en'),
 target_channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','uncertain','superseded')),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 output_thumbnail_id uuid REFERENCES thumbnails(id) ON DELETE RESTRICT,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tutorial_thumbnail_fanout_approval_locale
 ON tutorial_thumbnail_fanout(source_job_id,approval_revision,target_language);
CREATE INDEX IF NOT EXISTS idx_tutorial_thumbnail_fanout_pending ON tutorial_thumbnail_fanout(state,created_at);
