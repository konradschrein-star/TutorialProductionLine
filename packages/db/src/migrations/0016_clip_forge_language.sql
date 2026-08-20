-- Clip Forge — per-persona + per-source language.
-- Whisper needs the language code at transcription time. DeepSeek needs
-- it to write the suggestedCaption / reason in the right language and to
-- understand culturally-loaded clip-mining categories (e.g. a German
-- VOD wants German output strings, not English).

ALTER TABLE "cf_personas"
  ADD COLUMN "default_language" varchar(8) NOT NULL DEFAULT 'en';

ALTER TABLE "cf_sources"
  ADD COLUMN "language" varchar(8) NOT NULL DEFAULT 'en';

-- Backfill: sources inherit their persona's default at insert time once
-- the API is updated, but existing rows (if any) get 'en' from the default
-- above, which is fine.
