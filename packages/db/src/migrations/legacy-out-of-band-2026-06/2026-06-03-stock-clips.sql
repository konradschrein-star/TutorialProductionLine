-- Drama stock-chain template: pre-generated VEO t2v clip library.
-- Apply via `pnpm --filter @repo/db db:push` or run this file directly.

CREATE TABLE IF NOT EXISTS stock_clips (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  video_path    TEXT         NOT NULL,
  duration_sec  NUMERIC(6,3) NOT NULL,
  prompt        TEXT         NOT NULL,
  vibe_tag      VARCHAR(64),
  veo_job_id    TEXT,
  status        VARCHAR(16)  NOT NULL DEFAULT 'queued',
  origin        VARCHAR(24)  NOT NULL DEFAULT 'bootstrap',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS stock_clips_status_idx ON stock_clips(status);
CREATE INDEX IF NOT EXISTS stock_clips_last_used_at_idx ON stock_clips(last_used_at);

CREATE TABLE IF NOT EXISTS stock_clip_uses (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID         NOT NULL,
  stock_clip_id  UUID         NOT NULL REFERENCES stock_clips(id) ON DELETE CASCADE,
  position       NUMERIC(6,0) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_clip_uses_job_idx ON stock_clip_uses(job_id);
CREATE INDEX IF NOT EXISTS stock_clip_uses_clip_idx ON stock_clip_uses(stock_clip_id);
