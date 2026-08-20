-- Music library: add a format label so generated tracks can be
-- filtered to the format that produced them (e.g. LONG_FORM_DRAMA,
-- SPACE_VIDEO). Existing rows pre-date the column and stay NULL.
ALTER TABLE music_library
  ADD COLUMN IF NOT EXISTS format VARCHAR(50);
CREATE INDEX IF NOT EXISTS music_library_format_idx ON music_library(format);

-- Backfill the existing space-video tracks (they have genre='space').
UPDATE music_library
   SET format = 'SPACE_VIDEO'
 WHERE format IS NULL AND genre = 'space';
