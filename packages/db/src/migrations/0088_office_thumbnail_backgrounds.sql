ALTER TABLE tutorial_settings
  ALTER COLUMN thumbnail_background_rotation
  SET DEFAULT '["Office 1 · Window Desk","Office 2 · White Desk","Office 3 · Conference Room","Office 4 · Desktop"]'::jsonb;

UPDATE tutorial_settings
SET thumbnail_background_rotation = '["Office 1 · Window Desk","Office 2 · White Desk","Office 3 · Conference Room","Office 4 · Desktop"]'::jsonb
WHERE thumbnail_background_rotation IS DISTINCT FROM '["Office 1 · Window Desk","Office 2 · White Desk","Office 3 · Conference Room","Office 4 · Desktop"]'::jsonb;
