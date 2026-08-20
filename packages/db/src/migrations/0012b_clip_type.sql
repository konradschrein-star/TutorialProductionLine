-- Add clip_type classification for source material origin.
-- Drives clip selection priority: ai_generated clips are ranked lower than real footage.
DO $$ BEGIN
  CREATE TYPE clip_type AS ENUM (
    'text_on_screen',
    'footage_movie',
    'footage_clone_wars',
    'footage_animation',
    'footage_comic',
    'ai_generated',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS clip_type clip_type NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS clips_clip_type_idx ON clips (clip_type);
