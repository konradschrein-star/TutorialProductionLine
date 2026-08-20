-- Seed Remotion Caption Presets
-- This file creates default animation presets for Remotion-rendered captions

INSERT INTO remotion_caption_presets (name, is_default, config) VALUES
  ('Fade In/Out', true, '{
    "animation_type": "fade",
    "font_family": "Montserrat",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#AAFF00",
    "position": "bottom"
  }'),
  ('Slide Up', false, '{
    "animation_type": "slideUp",
    "font_family": "Montserrat",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#AAFF00",
    "position": "bottom"
  }'),
  ('Pop', false, '{
    "animation_type": "pop",
    "font_family": "Inter",
    "font_size": 68,
    "primary_color": "#FFFFFF",
    "highlight_color": "#FF6B6B",
    "position": "center"
  }'),
  ('Typewriter', false, '{
    "animation_type": "typewriter",
    "font_family": "Montserrat",
    "font_size": 64,
    "primary_color": "#FFFFFF",
    "highlight_color": "#00D9FF",
    "position": "bottom"
  }'),
  ('Smooth Highlight', false, '{
    "animation_type": "smoothHighlight",
    "font_family": "Inter",
    "font_size": 72,
    "primary_color": "#FFFFFF",
    "highlight_color": "#AAFF00",
    "position": "bottom"
  }')
ON CONFLICT DO NOTHING;
