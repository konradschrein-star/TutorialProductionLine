CREATE TABLE IF NOT EXISTS storage_artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES storage_artifacts(id) ON DELETE RESTRICT,
  drive_file_id text NOT NULL,
  vps_path text NOT NULL,
  bytes bigint,
  checksum_sha256 text,
  drive_md5 text,
  verified_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, drive_file_id)
);
-- Preserve known historical identities; NULL checksum/verification stays unknown.
INSERT INTO storage_artifact_versions (artifact_id,drive_file_id,vps_path,bytes,checksum_sha256,drive_md5,verified_at)
SELECT id,drive_file_id,vps_path,bytes,checksum_sha256,drive_md5,verified_at
FROM storage_artifacts WHERE drive_file_id IS NOT NULL
ON CONFLICT (artifact_id,drive_file_id) DO NOTHING;
