-- Persist the localized two-line copy used by the deterministic tutorial
-- thumbnail compositor.
--
-- NULL means metadata generation produced no usable copy. The compositor and
-- uploader handoff must surface that missing state; they must never replace it
-- with a generic English slogan. Both additions are idempotent so this remains
-- safe in the repository's out-of-band production migration flow.

ALTER TABLE tutorial_jobs
  ADD COLUMN IF NOT EXISTS thumbnail_text_top text,
  ADD COLUMN IF NOT EXISTS thumbnail_text_bottom text;
