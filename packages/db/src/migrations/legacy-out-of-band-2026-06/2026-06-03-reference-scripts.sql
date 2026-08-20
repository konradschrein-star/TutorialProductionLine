-- Reference scripts per clip library. Used by the script-writer to
-- imitate tone/structure. The script-gen step rotates through them
-- so the same reference doesn't drive every job.

CREATE TABLE IF NOT EXISTS clip_library_reference_scripts (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_library_id  UUID         NOT NULL REFERENCES clip_libraries(id) ON DELETE CASCADE,
  name             VARCHAR(160) NOT NULL,
  content          TEXT         NOT NULL,
  word_count       INTEGER      NOT NULL DEFAULT 0,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_library_reference_scripts_lib_idx
  ON clip_library_reference_scripts(clip_library_id);
CREATE INDEX IF NOT EXISTS clip_library_reference_scripts_lru_idx
  ON clip_library_reference_scripts(clip_library_id, last_used_at NULLS FIRST);

-- Library-level toggle: when ON, script-gen pulls a reference script.
-- When OFF, script-gen falls back to just system prompt + topic.
ALTER TABLE clip_libraries
  ADD COLUMN IF NOT EXISTS use_reference_scripts BOOLEAN NOT NULL DEFAULT TRUE;
