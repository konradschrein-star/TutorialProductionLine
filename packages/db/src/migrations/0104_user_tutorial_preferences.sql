ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_record_hotkey varchar(32) NOT NULL DEFAULT 'F8',
  ADD COLUMN IF NOT EXISTS tutorial_playback_speed varchar(8) NOT NULL DEFAULT '1';
