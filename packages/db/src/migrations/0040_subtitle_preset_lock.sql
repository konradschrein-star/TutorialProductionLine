-- 0040_subtitle_preset_lock.sql
--
-- Subtitle presets: explicit lock flag.
--
-- Editability used to be hardwired to `is_built_in`: a built-in preset was
-- permanently read-only and the only escape hatch was a "Clone to Edit" button
-- that was easy to miss entirely (the controls just silently did nothing).
--
-- `is_locked` decouples the two. It seeds from `is_built_in` so nothing changes
-- for anyone until they explicitly unlock, but from now on a built-in CAN be
-- unlocked and edited in place, and a user preset CAN be locked to protect it.
-- Deletion is still gated on `is_built_in` — unlocking must not make the
-- starter set destroyable.

ALTER TABLE subtitle_presets
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

UPDATE subtitle_presets
  SET is_locked = true
  WHERE is_built_in = true;
