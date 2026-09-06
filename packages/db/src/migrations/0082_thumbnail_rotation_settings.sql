ALTER TABLE tutorial_settings
  ADD COLUMN IF NOT EXISTS thumbnail_background_rotation jsonb NOT NULL DEFAULT '["Modern Minimal Tech","Neon Glow Studio","Dark Corporate Slate","Abstract Gradient Blue"]'::jsonb,
  ADD COLUMN IF NOT EXISTS thumbnail_persona_rotation jsonb NOT NULL DEFAULT '{}'::jsonb;
