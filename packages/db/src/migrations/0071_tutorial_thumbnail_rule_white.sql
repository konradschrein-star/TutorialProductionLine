-- 0071 — TUTORIAL_STUDIO thumbnail rule v3: white, 4 words, one logo, photoreal.
--
-- WHY: second owner review of generated tutorial thumbnails, 2026-08-06. The
-- v2-bright rule (migration 0069) fixed the darkness and the circular insets;
-- this round is about the FIELD, the TEXT COUNT and the LOGO. Verbatim:
--
--   "Why the fuck is the background this washed-out AI yellow? We do not want
--    that. We want the same thing as the references."
--   "Generally I see the yellowish beige background. I do not fully like that.
--    Clear white background is better in my opinion."
--   "There is sometimes tons and tons of text, way too much text. Four words is
--    the maximum for the shorter tutorials." / "The ideal in most cases is two
--    or three words."
--   "We have the Sage logo at the bottom. We do not need to repeat it."
--   "The thumbnail is about QuickBooks. Why the fuck is the Excel logo on there
--    instead of QuickBooks?"
--   "For some reason the guy turns into a comic character."
--   "We can make the text bigger in this example by having this weird icon at
--    the top not be there."
--
-- THE TWO ROOT CAUSES, both in the previous row:
--   1. palette_policy literally offered "off-white, cream, or a pale tint of
--      the product's brand colour" as the background. That clause IS the
--      washed-out yellow — a Google Slides tutorial reads "pale tint of yellow"
--      and floods the field with it. Replaced with flat white, no tint.
--   2. text_policy demanded "the software's exact name plus a 2-3 word outcome,
--      5 words total" — it ASKED for the duplicate name beside the logo, and
--      for five words. Now 4 max, and the name belongs to the logo. The
--      matching code change is condenseHeadline() in
--      apps/worker-orchestrator/src/utils/thumbnail/headline.ts, which strips
--      the brand from the headline unless the phrase collapses without it
--      ("Notion SOPs" survives; "Gusto" beside the Gusto logo does not).
--
-- The rule is read from the database on every generation
-- (getThumbnailFormatRule, no cache), so this UPDATE takes effect on the next
-- request. The code change does need a worker-orchestrator deploy.
--
-- Every string is LENGTH-TUNED against the 2000-char prompt ceiling that
-- veo_fleet/veoforge/vup enforce. If you lengthen a field, re-run the dry-run
-- renderer and check what fell off the tail.
--
-- DATA MIGRATION, not DDL. Safe to re-run. Rollback at the bottom.

UPDATE thumbnail_format_rules SET
  layout_archetype = 'white_headline_left_host_right',
  subject_scale_min = 0.300,
  subject_scale_max = 0.450,
  -- 4, not 5. The fifth word was the product name the logo already carries.
  text_max_words = 4,
  gaze_policy = 'direct',
  -- LENGTH MATTERS HERE: text_policy and palette_policy are both quoted in the
  -- REQUIRED tier of the rendered prompt, so every character they spend is a
  -- character the AVOID list and the archetype description do not get.
  text_policy =
    '2-4 words, 3 ideal. Set it HUGE — the biggest element after the host. Near-black on white, or white on one brand-colour block.',
  subject_policy =
    'ONE person: the host, a real photograph, cut out in the right third, waist-up, facing camera, pointing at the headline or the logo. Never illustrated, never in a circle.',
  palette_policy =
    'Flat WHITE background: not cream, beige, off-white, tinted or gradient. Brand colour only on the logo, the type and one accent block. Near-black type. One red arrow allowed.',
  signature_element =
    'ONE official product logo at giant size — a fifth of the frame wide or more, accurately drawn, never cropped, and the only logo present.',
  composition = ARRAY[
    'Exactly three elements: the headline, the product logo, the host. Nothing else — no icons, no badges, no chips, no sparkles, no decorative shapes.',
    'The headline is the largest graphic element. If it does not fit, cut words, never shrink the type.',
    'If any software UI appears, it is ONE cropped panel large enough to read, never a full dense screenshot.'
  ],
  -- ORDER IS LOAD-BEARING. The renderer emits the FIRST THREE as a required
  -- line and lets the rest be cut from the tail, so these three are the ones
  -- that reach the model on every single generation. They are the three
  -- complaints the owner made most often on 2026-08-06. Items 7-9 are last-round
  -- rejections that the v2 rule already fixed and that subject_policy restates;
  -- items 10-12 are restated by the REQUIRED palette and branding lines. That is
  -- why those can afford to be the ones that fall off.
  negatives = ARRAY[
    'cream, beige, off-white, tinted or gradient backgrounds',
    'any logo but the named product''s',
    'the product name set as text beside its own logo',
    'a cartoon, comic or illustrated person — the host is a photograph',
    'decorative icons, badges, chips, ribbons or sparkles',
    'more than four words of text',
    'a circle, oval or bubble around the person',
    'a second person, face or hand',
    'busy backgrounds: dense screenshots, circuits, bokeh, particles',
    'small or cropped logos',
    'dark backgrounds',
    'orange outside an official logo'
  ],
  rules_version = 'v3-white',
  authoring_notes =
    'Rewritten 2026-08-06 from the owner''s second review. Do not reintroduce: tinted/cream backgrounds, the product name beside its own logo, five-word headlines, illustrated hosts, decorative icons. Migration 0071 carries the exact rollback to v2-bright.',
  evidence_note =
    'Owner review of 26 regenerated tutorial thumbnails, 2026-08-06 — direct operator judgement on real output, itemised per thumbnail.',
  updated_at = now()
WHERE format = 'TUTORIAL_STUDIO';

-- ── ROLLBACK (the v2-bright row from migration 0069, verbatim) ──────────────
-- UPDATE thumbnail_format_rules SET
--   layout_archetype = 'bright_headline_left_host_right',
--   subject_scale_min = 0.300,
--   subject_scale_max = 0.450,
--   text_max_words = 5,
--   gaze_policy = 'direct',
--   text_policy = 'The software''s exact name plus a 2-3 word outcome, 5 words total. Dark type on the light background, or white/yellow on a colour block.',
--   subject_policy = 'ONE person: the host, cut out in the right third, waist-up, facing camera, pointing at the headline or the logo. Never in a circle, oval or bubble.',
--   palette_policy = 'BRIGHT — light background (off-white, cream, or a pale tint of the product''s brand colour), white and yellow accents, near-black or navy type, one red arrow. No orange, no dark field, no glow.',
--   signature_element = 'The product''s official logo at giant size — a fifth of the frame wide or more, accurately drawn, never cropped. One red arrow may point at what matters.',
--   composition = ARRAY[
--     'Bright, high-key: light background, evenly lit subject, no vignette, no dark corners.',
--     'Stupid simple: three elements maximum — headline, product logo, host. Nothing else.',
--     'If any software UI appears, it is ONE cropped panel large enough to read, never a full dense screenshot.'
--   ],
--   negatives = ARRAY[
--     'a circle, oval or bubble around the person',
--     'a second person, face or hand',
--     'busy backgrounds: dense screenshots, circuits, bokeh, particles',
--     'small or cropped logos',
--     'dark or black backgrounds',
--     'orange outside an official logo'
--   ],
--   rules_version = 'v2-bright',
--   updated_at = now()
-- WHERE format = 'TUTORIAL_STUDIO';

-- ── The one archetype that mandated cream ───────────────────────────────────
-- "Search-Intent #1 Learn + Beginners Tutorial" opens its layout prose with
-- "warm off-white / cream flat background — never pure white". That sentence is
-- REQUIRED in the rendered prompt (it is the archetype's lead directive), so it
-- would out-argue the palette policy above on exactly the channel that uses it
-- most — Blink Blueprint cycles it at weight 10.
--
-- Narrow edit: the ban on white is lifted and white leads. Nothing else about
-- the template changes; the owner liked its output ("image number 4 and image
-- number 5 look good. Image number 6 also looks good") and the rest of the
-- 1216-character description is why.
UPDATE thumbnail_archetypes SET
  layout_instructions = replace(
    layout_instructions,
    'warm off-white / cream flat background — never pure white, never a dark or textured tech background, and never a screen inset.',
    'clean flat white background — never a dark or textured tech background, and never a screen inset.'
  ),
  updated_at = now()
WHERE name = 'Search-Intent #1 Learn + Beginners Tutorial'
  AND layout_instructions LIKE '%warm off-white / cream flat background%';

-- Rollback for the archetype edit:
-- UPDATE thumbnail_archetypes SET layout_instructions = replace(
--   layout_instructions,
--   'clean flat white background — never a dark or textured tech background, and never a screen inset.',
--   'warm off-white / cream flat background — never pure white, never a dark or textured tech background, and never a screen inset.'
-- ) WHERE name = 'Search-Intent #1 Learn + Beginners Tutorial';
