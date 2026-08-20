-- Add sparse embedding storage column to clips
-- Dense embedding (halfvec) is added in a separate migration
ALTER TABLE clips ADD COLUMN IF NOT EXISTS embedding_sparse jsonb;
