-- Drama stock-chain template: extend the existing clip_libraries
-- table with the per-library drama settings (script prompt, character
-- block, music settings) and add a FK on channels so each channel
-- can point at one clip_library.

-- New columns on the existing clip_libraries table. The original
-- schema is in clip-library.ts (clip-pipeline system); these are
-- additive and unused by the original consumers.
ALTER TABLE clip_libraries
  ADD COLUMN IF NOT EXISTS character_block TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS script_prompt   TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS music_mode      VARCHAR(16) NOT NULL DEFAULT 'generate',
  ADD COLUMN IF NOT EXISTS music_volume_db INTEGER     NOT NULL DEFAULT -28;

-- Channel → clip_library link. Channels may share libraries (many → one).
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS clip_library_id UUID
    REFERENCES clip_libraries(id) ON DELETE SET NULL;

-- stock_clips → clip_library link. Already migrated in some runs of
-- this same SQL — IF NOT EXISTS guards keep it idempotent.
ALTER TABLE stock_clips
  ADD COLUMN IF NOT EXISTS clip_library_id UUID
    REFERENCES clip_libraries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_clips_library_idx
  ON stock_clips(clip_library_id);

-- Seed the default Black-drama library so the create-form has
-- something to point at and existing stock_clips can be reassigned.
INSERT INTO clip_libraries (name, slug, description,
                            character_block, script_prompt,
                            music_mode, music_volume_db)
SELECT
  'Black Drama (default)',
  'black-drama-default',
  'Default channel library for the drama stock-chain template.',
  'Black couples and Black families in their 30s. Black men are the primary POV characters. Realistic American settings, contemporary clothing.',
  'You are writing a reality-TV-style story script for a Black-drama YouTube channel. The protagonist is always a Black man in his 30s. Keep the tone grounded, emotional, and grounded in everyday American life. Avoid prestige drama affect. Output the full narrative script in plain prose, no scene headings or character labels.',
  'generate',
  -28
WHERE NOT EXISTS (
  SELECT 1 FROM clip_libraries WHERE slug = 'black-drama-default'
);

-- Backfill: any stock_clips row without a library gets the default.
UPDATE stock_clips
   SET clip_library_id = (SELECT id FROM clip_libraries
                          WHERE slug = 'black-drama-default')
 WHERE clip_library_id IS NULL;
