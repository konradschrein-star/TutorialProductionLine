CREATE TABLE IF NOT EXISTS thumbnail_asset_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_key text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  include_in_rotation boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_key)
);
CREATE TABLE IF NOT EXISTS tutorial_thumbnail_drafts (
  tutorial_job_id uuid PRIMARY KEY REFERENCES tutorial_jobs(id) ON DELETE CASCADE,
  layout jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  base_thumbnail_id uuid,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
