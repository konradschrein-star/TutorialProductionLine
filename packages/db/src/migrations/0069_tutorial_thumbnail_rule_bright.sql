-- 0069 — TUTORIAL_STUDIO thumbnail rule: bright, simple, one person, big brand.
--
-- WHY: the owner reviewed 30 generated tutorial thumbnails on 2026-08-05 and
-- rejected the look. Verbatim: "They are way too dark on average." / "It seems
-- for some reason you put the people into circles. That does not make any
-- sense." / "In a thumbnail there should only be one person so when making the
-- prompt write in singular." / "The logos are way too small and from afar I
-- really can't see what the tutorial is about, what software the tutorial is
-- about, or what problem it solves." / "The background is way too noisy on most
-- thumbnails. We have to keep it stupid simple." / "I do not like this orange
-- appearing everywhere. I would rather the yellow and the white. These are good
-- colors. The red arrow is also good."
--
-- Almost all of that was ONE row. The previous values literally asked for the
-- circle ("circular host inset upper-right"), the orange ("Tech blues/greys +
-- orange accent") and the darkness ("white or yellow on dark"). The rule is
-- read from the database on every generation (getThumbnailFormatRule, no
-- cache), so this UPDATE takes effect on the next request with no deploy.
--
-- Every string here is LENGTH-TUNED: the whole prompt must fit the 2000-char
-- ceiling that veo_fleet/veoforge/vup enforce, and verbose policy text pushes
-- the AVOID list and the archetype's own layout description out of the prompt.
-- If you lengthen a field, re-run the dry-run renderer and check what fell off.
--
-- DATA MIGRATION, not DDL. Safe to re-run. The rollback that restores the
-- previous values verbatim is at the bottom of this file.

UPDATE thumbnail_format_rules SET
  layout_archetype = 'bright_headline_left_host_right',
  subject_scale_min = 0.300,
  subject_scale_max = 0.450,
  text_max_words = 5,
  gaze_policy = 'direct',
  text_policy =
    'The software''s exact name plus a 2-3 word outcome, 5 words total. Dark type on the light background, or white/yellow on a colour block.',
  subject_policy =
    'ONE person: the host, cut out in the right third, waist-up, facing camera, pointing at the headline or the logo. Never in a circle, oval or bubble.',
  palette_policy =
    'BRIGHT — light background (off-white, cream, or a pale tint of the product''s brand colour), white and yellow accents, near-black or navy type, one red arrow. No orange, no dark field, no glow.',
  signature_element =
    'The product''s official logo at giant size — a fifth of the frame wide or more, accurately drawn, never cropped. One red arrow may point at what matters.',
  composition = ARRAY[
    'Bright, high-key: light background, evenly lit subject, no vignette, no dark corners.',
    'Stupid simple: three elements maximum — headline, product logo, host. Nothing else.',
    'If any software UI appears, it is ONE cropped panel large enough to read, never a full dense screenshot.'
  ],
  -- ORDER MATTERS: the renderer's AVOID line is elastic and cuts from the TAIL
  -- to fit the prompt budget. 'dark' and 'orange' sit last on purpose — the
  -- REQUIRED palette line already forbids both, so everything above them is
  -- said nowhere else in the prompt.
  negatives = ARRAY[
    'a circle, oval or bubble around the person',
    'a second person, face or hand',
    'busy backgrounds: dense screenshots, circuits, bokeh, particles',
    'small or cropped logos',
    'dark or black backgrounds',
    'orange outside an official logo'
  ],
  rules_version = 'v2-bright',
  authoring_notes =
    'Rewritten 2026-08-05 from the owner''s review of 30 generated thumbnails. Do not reintroduce: circular host insets, orange accents, dark backgrounds, plural people, or small logos. Migration 0069 carries the exact rollback.',
  evidence_note =
    'Owner review of 30 generated tutorial thumbnails, 2026-08-05 — direct operator judgement, which outranks the practitioner convention this row previously encoded.',
  updated_at = now()
WHERE format = 'TUTORIAL_STUDIO';

-- ── ROLLBACK (the previous row, verbatim) ───────────────────────────────────
-- UPDATE thumbnail_format_rules SET
--   layout_archetype = 'screen_inset',
--   subject_scale_min = 0.600,
--   subject_scale_max = 0.700,
--   text_max_words = 5,
--   gaze_policy = 'at_subject',
--   text_policy = 'Outcome phrase, white or yellow on dark. Withhold the METHOD.',
--   subject_policy = 'Screen capture ~65% left, circular host inset upper-right. A centred face competes with the screen; a cornered face merely identifies. Show a recognisable software UI or framework logo, not generic code.',
--   palette_policy = 'Tech blues/greys + orange accent.',
--   signature_element = 'Recognisable software UI or framework logo; arrows are genre-native here.',
--   composition = ARRAY[]::text[],
--   negatives = ARRAY[
--     'generic code editor with unreadable code',
--     'centred face over the screen',
--     'revealing the final result/answer'
--   ],
--   rules_version = 'v1',
--   authoring_notes = NULL,
--   evidence_note = 'Practitioner convention (plan §A5.5) — thinnest-evidenced part of the research, tune against real output. Global gates (§A5.6) are better sourced.',
--   updated_at = now()
-- WHERE format = 'TUTORIAL_STUDIO';
