-- Create caption_presets table
CREATE TABLE IF NOT EXISTS caption_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caption_presets_name ON caption_presets(name);
CREATE INDEX IF NOT EXISTS idx_caption_presets_default ON caption_presets(is_default);

-- Seed default caption presets
INSERT INTO caption_presets (name, is_default, config) VALUES
(
  'Default',
  true,
  '{"position": "bottom-center", "vertical_offset_percent": 10, "font_family": "Arial", "font_size": 72, "primary_color": "#FFFFFF", "highlight_color": "#FFFF00", "all_caps": false, "show_punctuation": true, "window_size": 6, "outline_width": 2, "shadow_offset": 1}'::jsonb
),
(
  'Large Bold',
  false,
  '{"position": "bottom-center", "vertical_offset_percent": 12, "font_family": "Impact", "font_size": 96, "primary_color": "#FFFFFF", "highlight_color": "#FF6B6B", "all_caps": true, "show_punctuation": false, "window_size": 4, "outline_width": 4, "shadow_offset": 2}'::jsonb
),
(
  'Minimal',
  false,
  '{"position": "top-center", "vertical_offset_percent": 10, "font_family": "Helvetica", "font_size": 48, "primary_color": "#FFFFFF", "highlight_color": "#00FF00", "all_caps": false, "show_punctuation": true, "window_size": 8, "outline_width": 0, "shadow_offset": 0}'::jsonb
),
(
  'Yellow Highlight',
  false,
  '{"position": "bottom-center", "vertical_offset_percent": 10, "font_family": "Arial", "font_size": 72, "primary_color": "#FFFF00", "highlight_color": "#00FF00", "all_caps": false, "show_punctuation": true, "window_size": 6, "outline_width": 2, "shadow_offset": 1}'::jsonb
),
(
  'Tutorial Style',
  false,
  '{"position": "bottom-center", "vertical_offset_percent": 8, "font_family": "Roboto", "font_size": 64, "primary_color": "#F0F0F0", "highlight_color": "#4A90E2", "all_caps": false, "show_punctuation": true, "window_size": 7, "outline_width": 2, "shadow_offset": 1}'::jsonb
),
(
  'Gaming Style',
  false,
  '{"position": "top-left", "vertical_offset_percent": 5, "font_family": "Consolas", "font_size": 56, "primary_color": "#00FF00", "highlight_color": "#FF00FF", "all_caps": true, "show_punctuation": false, "window_size": 5, "outline_width": 3, "shadow_offset": 2}'::jsonb
),
(
  'Accessibility',
  false,
  '{"position": "bottom-center", "vertical_offset_percent": 15, "font_family": "Arial", "font_size": 84, "primary_color": "#FFFFFF", "highlight_color": "#FFFF00", "all_caps": false, "show_punctuation": true, "window_size": 6, "outline_width": 4, "shadow_offset": 2}'::jsonb
),
(
  'Karaoke',
  false,
  '{"position": "center", "vertical_offset_percent": 0, "font_family": "Times New Roman", "font_size": 80, "primary_color": "#FFFFFF", "highlight_color": "#FF69B4", "all_caps": false, "show_punctuation": true, "window_size": 3, "outline_width": 3, "shadow_offset": 1}'::jsonb
)
ON CONFLICT DO NOTHING;
