-- 0062: tags on thumbnail_archetypes
--
-- The archetype library had exactly two usable axes of description: `category`
-- (43 of 44 rows said "General") and `formats` (populated on 7 rows). Neither
-- answers the question an operator actually asks when picking a reference —
-- "is this for a full guide, a mobile tutorial, a criticism piece, or an app
-- rating?" — nor the structural questions that decide whether a reference can
-- carry a given video at all ("does it have a screen inset? a face? a logo?").
--
-- `tags` is a free text[] validated in the app layer, deliberately NOT a pg
-- enum, so the vocabulary can grow without a migration (same reasoning as
-- `formats` above it). The vocabulary in use at the time of writing:
--
--   intent      search-intent | curiosity-gap
--   bucket      full-guide, mobile-tutorial, criticism, rating-apps,
--               comparison, feature-highlight, listicle, news, humor,
--               beginner, integration
--   structure   has-face, face-placeholder, no-person, screen-inset,
--               phone-inset, flat-background, dark-background, logo,
--               series-badge, arrow, template
--   status      weak, garbled-text, person-specific, duplicate, junk
--
-- GIN so `tags && ARRAY[...]` / `tags @> ARRAY[...]` filters stay cheap as the
-- library grows. It is created here and NOT declared in thumbnails.ts, because
-- drizzle-kit generate is broken in this repo and a plain index() declaration
-- would silently claim a btree that does not exist.

ALTER TABLE thumbnail_archetypes
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_thumbnail_archetypes_tags
  ON thumbnail_archetypes USING GIN (tags);
