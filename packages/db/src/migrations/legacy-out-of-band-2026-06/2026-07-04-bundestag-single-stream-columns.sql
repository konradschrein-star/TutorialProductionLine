-- BUNDESTAG single-stream architecture added start_offset/end_offset/party/
-- speaker_name to packages/db/src/schema/bundestag-clips.ts (see
-- bundestag-clip-analysis.ts, which inserts these columns), but the migration
-- was never generated/applied to production — confirmed missing from the
-- 2026-07-02 prod schema baseline. Every real BUNDESTAG job has therefore
-- failed at the clip-insert transaction with "column does not exist" since
-- the single-stream refactor shipped (0 real jobs had ever completed clip
-- analysis before this fix). Purely additive/nullable, safe against the
-- existing (empty) table.
-- Idempotent: skipped if already present.
ALTER TABLE bundestag_clips
  ADD COLUMN IF NOT EXISTS start_offset numeric(10, 3),
  ADD COLUMN IF NOT EXISTS end_offset numeric(10, 3),
  ADD COLUMN IF NOT EXISTS party varchar(50),
  ADD COLUMN IF NOT EXISTS speaker_name varchar(255);
