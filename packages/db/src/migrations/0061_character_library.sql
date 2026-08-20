-- 0061_character_library.sql
--
-- CHARACTER LIBRARY — one source of truth for "who is the human on this channel".
--
-- Context (verified against prod 2026-08-03):
--   characters              0 rows   (built months ago for drama, never populated)
--   channel_personas        0 rows   (what the thumbnail engine actually reads)
--   assets/character_state  0 rows
--
-- Because BOTH tables are empty there is no data to reconcile, so this migration
-- takes the honest option instead of the cheap one:
--
--   * `characters` becomes the single source of truth. It gains many images
--     (character_images) and many channels (character_channels).
--   * `channel_personas` stops being a TABLE and becomes a read-only VIEW
--     projected out of characters. It is now physically impossible for the two
--     to disagree — the failure mode that has already cost this project dearly.
--     Every existing reader keeps working; every writer fails loudly (correct:
--     the Branding form now edits the character, not a shadow copy).
--
-- Applied BY HAND on prod (there is no migration tracking on this database).

BEGIN;

-- ── 1. characters: role + notes ─────────────────────────────────────────────
-- `role` separates the drama cast ('cast') from the on-camera channel host
-- ('host') that the thumbnail engine looks for. Default 'host' because every
-- character created from here on is a host until stated otherwise.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'host';
-- Free-form operator notes (mirrors channel_personas.notes, which is folded in).
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN characters.channel_id IS
  'DERIVED — do not write. Maintained by trigger from the primary row in '
  'character_channels. Kept only so the pre-existing drama queries that filter '
  'on it keep working.';

-- ── 2. character_images — the "few images" per character ────────────────────
-- A character has MANY images; thumbnail generation cycles through them so the
-- channel gets visual variation with a constant face. `pose` and `expression`
-- are parsed out of the source filenames (which encode them) and preserved so a
-- future brief can pick a pose that matches its gaze/emotion directive instead
-- of taking whatever the cycle lands on.
CREATE TABLE IF NOT EXISTS character_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- Absolute path on the media root of the NORMALISED i2i reference image.
  image_path        text NOT NULL,
  -- Absolute path of the untouched upload, kept so a reference can be
  -- re-derived at a different spec without re-generating the character.
  original_path     text,
  -- 'pointing' | 'smiling' | 'surprised' | 'neutral' | 'smirk' | ... free-form.
  pose              varchar(48),
  expression        varchar(48),
  source_filename   text,
  width             integer,
  height            integer,
  byte_size         integer,
  -- Stable cycle order. The deterministic picker sorts by
  -- (sort_order, created_at, id) so the job -> image mapping never shifts.
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_images_character
  ON character_images(character_id, is_active, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_images_unique_path
  ON character_images(character_id, image_path);

-- ── 3. character_channels — one character, one-to-many channels ─────────────
-- The owner: "a character can be assigned to a channel or even multiple
-- channels, but in most cases to one channel". This table is AUTHORITATIVE for
-- channel binding.
CREATE TABLE IF NOT EXISTS character_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- 'host'  = the on-camera face the thumbnail engine must use for this channel
  -- 'cast'  = appears in content but is not the channel's face
  role          varchar(24) NOT NULL DEFAULT 'host',
  -- The character's home channel (drives the derived characters.channel_id) and,
  -- for role='host', the one the thumbnail engine resolves.
  is_primary    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_channels_unique
  ON character_channels(character_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_character_channels_channel
  ON character_channels(channel_id, role);
-- At most ONE primary host per channel. Without this a channel could resolve two
-- different faces depending on row order, which is the exact silent-disagreement
-- class of bug this migration exists to remove.
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_channels_one_primary_host
  ON character_channels(channel_id)
  WHERE role = 'host' AND is_primary;

-- ── 4. Keep the legacy characters.channel_id honest ─────────────────────────
-- characters.channel_id is now DERIVED. These two triggers make drift
-- impossible rather than merely discouraged.
CREATE OR REPLACE FUNCTION character_home_channel(p_character_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT cc.channel_id
  FROM character_channels cc
  WHERE cc.character_id = p_character_id
  ORDER BY cc.is_primary DESC, cc.created_at ASC, cc.id ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION sync_character_home_channel()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  target := COALESCE(NEW.character_id, OLD.character_id);
  UPDATE characters
     SET channel_id = character_home_channel(target)
   WHERE id = target;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_character_channels_sync ON character_channels;
CREATE TRIGGER trg_character_channels_sync
  AFTER INSERT OR UPDATE OR DELETE ON character_channels
  FOR EACH ROW EXECUTE FUNCTION sync_character_home_channel();

CREATE OR REPLACE FUNCTION force_character_home_channel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.channel_id := character_home_channel(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_force_home_channel ON characters;
CREATE TRIGGER trg_characters_force_home_channel
  BEFORE INSERT OR UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION force_character_home_channel();

-- ── 5. channel_personas: TABLE -> read-only VIEW ────────────────────────────
-- Fold whatever exists into characters first (verified 0 rows on prod, but a
-- migration that only works on an empty table is not a migration).
INSERT INTO characters (name, description, notes, role, is_active)
SELECT p.name, p.description, p.notes, 'host', true
FROM channel_personas p
WHERE NOT EXISTS (
  SELECT 1 FROM character_channels cc WHERE cc.channel_id = p.channel_id
);

INSERT INTO character_channels (character_id, channel_id, role, is_primary)
SELECT c.id, p.channel_id, 'host', true
FROM channel_personas p
JOIN characters c ON c.name = p.name AND c.description = p.description
WHERE NOT EXISTS (
  SELECT 1 FROM character_channels cc WHERE cc.channel_id = p.channel_id
);

INSERT INTO character_images (character_id, image_path, pose, sort_order, source_filename)
SELECT cc.character_id, p.image_path, 'legacy', 0, 'channel_personas.image_path'
FROM channel_personas p
JOIN character_channels cc ON cc.channel_id = p.channel_id
WHERE p.image_path IS NOT NULL AND btrim(p.image_path) <> ''
ON CONFLICT DO NOTHING;

DROP TABLE channel_personas;

-- Same column list and types as the dropped table, so every existing SELECT
-- keeps compiling. image_path is the character's FIRST image — the engine no
-- longer reads it (it cycles over character_images directly); it is here for
-- back-compat and for the Studio's preview tile.
CREATE VIEW channel_personas AS
SELECT
  cc.channel_id                                    AS channel_id,
  c.name                                           AS name,
  c.description                                    AS description,
  (
    SELECT ci.image_path
    FROM character_images ci
    WHERE ci.character_id = c.id AND ci.is_active
    ORDER BY ci.sort_order, ci.created_at, ci.id
    LIMIT 1
  )                                                AS image_path,
  c.notes                                          AS notes,
  c.created_at                                     AS created_at,
  c.updated_at                                     AS updated_at
FROM character_channels cc
JOIN characters c ON c.id = cc.character_id
WHERE cc.role = 'host' AND cc.is_primary AND c.is_active;

COMMENT ON VIEW channel_personas IS
  'READ-ONLY compat projection of the character library (migration 0061). '
  'The former table had a single image_path, which made thumbnail cycling '
  'impossible. Edit characters / character_images / character_channels instead; '
  'INSERT or UPDATE here will fail on purpose.';

COMMIT;
