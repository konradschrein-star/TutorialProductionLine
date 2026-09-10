-- Migration/source verification evidence is append-only. Duplicate INSERT ...
-- ON CONFLICT DO NOTHING remains valid: only mutation of existing rows is denied.
CREATE OR REPLACE FUNCTION reject_storage_artifact_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'storage artifact history is append-only' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS storage_artifact_versions_append_only ON storage_artifact_versions;
CREATE TRIGGER storage_artifact_versions_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON storage_artifact_versions
FOR EACH STATEMENT EXECUTE FUNCTION reject_storage_artifact_version_mutation();
