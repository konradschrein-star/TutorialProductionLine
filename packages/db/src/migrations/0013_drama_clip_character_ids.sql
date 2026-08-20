-- Per-clip character tracking: which characters from the preset library
-- appear in each drama_clip. Lets us pass only the relevant character
-- reference images to Nano Banana / VEO (max 6 refs per call), instead of
-- the old "all characters for every clip" approach which broke past 6 chars.
ALTER TABLE drama_clips
  ADD COLUMN IF NOT EXISTS character_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS drama_clips_character_ids_idx
  ON drama_clips USING gin (character_ids);
