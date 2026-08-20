-- Clip Forge — extend cf_style_presets so a preset can store a fully custom
-- CaptionStyle (subtitle words + caption pill) plus per-layoutKind safe-zone
-- overrides and a phrase-pacing knob. Before this migration a preset could
-- only point at a hardcoded registry entry by name; now it can carry its own
-- colors/fonts/animation/etc.
ALTER TABLE cf_style_presets
  ADD COLUMN IF NOT EXISTS subtitle_style    jsonb,
  ADD COLUMN IF NOT EXISTS caption_style     jsonb,
  ADD COLUMN IF NOT EXISTS safe_zones        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phrase_length_ms  integer,
  ADD COLUMN IF NOT EXISTS updated_at        timestamp with time zone NOT NULL DEFAULT now();
