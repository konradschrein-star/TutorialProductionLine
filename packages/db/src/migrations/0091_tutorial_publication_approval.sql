ALTER TABLE tutorial_jobs ADD COLUMN IF NOT EXISTS publication_approval jsonb;
ALTER TABLE tutorial_upload_dispatches ADD COLUMN IF NOT EXISTS approved_asset_snapshot jsonb;
-- Existing approvals are intentionally not backfilled with invented hashes.
