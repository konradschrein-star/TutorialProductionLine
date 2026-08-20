-- Professional Caption Presets Migration
-- Adds 4 new professional presets with Montserrat/Inter fonts

-- Corporate Clean (Montserrat, white, subtle)
INSERT INTO caption_presets (id, name, is_default, config)
VALUES (
  gen_random_uuid(),
  'Corporate Clean',
  false,
  '{
    "position": "bottom-center",
    "vertical_offset_percent": 15,
    "font_family": "Montserrat",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#AAFF00",
    "all_caps": false,
    "show_punctuation": true,
    "window_size": 4,
    "outline_width": 2,
    "shadow_offset": 2
  }'::jsonb
);

-- Corporate Bold (Inter, white, thick outline)
INSERT INTO caption_presets (id, name, is_default, config)
VALUES (
  gen_random_uuid(),
  'Corporate Bold',
  false,
  '{
    "position": "bottom-center",
    "vertical_offset_percent": 15,
    "font_family": "Inter",
    "font_size": 78,
    "primary_color": "#FFFFFF",
    "highlight_color": "#AAFF00",
    "all_caps": false,
    "show_punctuation": true,
    "window_size": 3,
    "outline_width": 4,
    "shadow_offset": 2
  }'::jsonb
);

-- Colorful Yellow (Montserrat, yellow highlight)
INSERT INTO caption_presets (id, name, is_default, config)
VALUES (
  gen_random_uuid(),
  'Colorful Yellow',
  false,
  '{
    "position": "bottom-center",
    "vertical_offset_percent": 15,
    "font_family": "Montserrat",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#FFD700",
    "all_caps": true,
    "show_punctuation": true,
    "window_size": 4,
    "outline_width": 3,
    "shadow_offset": 2
  }'::jsonb
);

-- Colorful Lime (Montserrat, lime highlight)
INSERT INTO caption_presets (id, name, is_default, config)
VALUES (
  gen_random_uuid(),
  'Colorful Lime',
  true,
  '{
    "position": "bottom-center",
    "vertical_offset_percent": 15,
    "font_family": "Montserrat",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#32CD32",
    "all_caps": true,
    "show_punctuation": true,
    "window_size": 4,
    "outline_width": 3,
    "shadow_offset": 2
  }'::jsonb
);
