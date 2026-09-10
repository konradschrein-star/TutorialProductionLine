-- Separate optional wire contract; the r1 Drive publisher does not consume generic_* states.
ALTER TABLE tutorial_upload_dispatches ADD COLUMN IF NOT EXISTS scheduled_delivery jsonb;
