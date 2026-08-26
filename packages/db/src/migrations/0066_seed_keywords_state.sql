-- State tracking + soft-delete for the "Initial Keywords" fallback, mirroring
-- the workflow states the previous tutorial tool tracked per keyword. The VA
-- moves a keyword To do → In progress → Done, and can delete ("don't want to
-- do") one, which hides it from the list.
ALTER TABLE seed_keywords
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'NEW';
ALTER TABLE seed_keywords
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE seed_keywords
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Fast filtering of the active (non-deleted) rows by status.
CREATE INDEX IF NOT EXISTS idx_seed_keywords_status
  ON seed_keywords (status)
  WHERE deleted_at IS NULL;
