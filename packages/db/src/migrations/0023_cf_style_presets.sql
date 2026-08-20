-- Clip Forge — named style presets.
-- A preset bundles a subtitle style + caption pill style + layout options
-- (positions, toggles, fit mode) that the Studio screen can save and reuse
-- across clips. Persona-scoped if persona_id is set, otherwise global.
CREATE TABLE IF NOT EXISTS cf_style_presets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(128) NOT NULL,
  persona_id         uuid REFERENCES cf_personas(id) ON DELETE CASCADE,
  subtitle_style_id  varchar(64),
  caption_style_id   varchar(64),
  layout_options     jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption_y          integer,
  subtitle_y         integer,
  caption_size       integer,
  subtitle_size      integer,
  notes              text,
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_style_presets_persona_idx
  ON cf_style_presets (persona_id);

CREATE UNIQUE INDEX IF NOT EXISTS cf_style_presets_persona_name_uq
  ON cf_style_presets (COALESCE(persona_id::text, ''), name);
