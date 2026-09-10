ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tutorial_dispatch_paused boolean NOT NULL DEFAULT false;
