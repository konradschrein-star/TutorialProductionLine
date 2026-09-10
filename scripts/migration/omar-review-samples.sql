\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT j.id,j.title,j.language,j.final_path,j.recording_path
FROM tutorial_jobs j WHERE j.language='English' AND j.final_path IS NOT NULL
AND EXISTS (SELECT 1 FROM storage_artifacts a WHERE a.job_id=j.id AND a.kind='final_video' AND a.verified_at IS NOT NULL)
ORDER BY j.completed_at DESC LIMIT 2;
SELECT id,name FROM characters ORDER BY name;
COMMIT;
