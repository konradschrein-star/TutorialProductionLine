-- 0020: extend cf_finishing_variants for layout + style registry references
--
-- The Clip Forge "multiply" system renders N variants per raw_clip, each
-- a different combination of {layout, subtitle style, caption style,
-- caption text, layout knobs}. The existing variants table already had
-- subtitle_style JSONB; we add explicit fields for everything else so
-- the renderer can reproduce a variant deterministically.
ALTER TABLE cf_finishing_variants
  ADD COLUMN layout_preset varchar(32),
  ADD COLUMN subtitle_style_id varchar(64),
  ADD COLUMN caption_style_id varchar(64),
  ADD COLUMN layout_options jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Shape of layout_options:
--   {
--     "showFrames": true,
--     "captionY": 112,        -- pixel override (null => preset default)
--     "captionSize": 46,
--     "subtitleY": 932,
--     "subtitleSize": 72,
--     "vhsIntensity": 0,      -- 0..1
--     "saturationBoost": 0    -- 0..1
--   }

-- One row per (clip, seed): re-running the same recipe overwrites the
-- previous render instead of creating a duplicate variant.
CREATE UNIQUE INDEX IF NOT EXISTS cf_variants_clip_seed_uidx
  ON cf_finishing_variants (raw_clip_id, variant_seed);
