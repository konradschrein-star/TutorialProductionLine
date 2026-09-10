\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SELECT id, email, name, role, is_active, default_tutorial_channel_id FROM users ORDER BY name;
SELECT id, name, language, youtube_channel_id, uploader_channel_key, is_primary, accepts_tutorials FROM channels ORDER BY language, name;
SELECT status, language, count(*) AS jobs, count(*) FILTER (WHERE delivered_to_drive) AS marked_delivered FROM tutorial_jobs GROUP BY status, language ORDER BY status, language;
SELECT kind, state, count(*) AS files, count(*) FILTER (WHERE drive_file_id IS NOT NULL AND verified_at IS NOT NULL) AS recorded_verified, sum(bytes) AS bytes FROM storage_artifacts GROUP BY kind,state ORDER BY kind,state;
SELECT count(*) AS characters FROM characters;
SELECT count(*) AS character_images FROM character_images;
SELECT count(*) AS thumbnail_library_assets FROM thumbnail_library_assets;
COMMIT;
