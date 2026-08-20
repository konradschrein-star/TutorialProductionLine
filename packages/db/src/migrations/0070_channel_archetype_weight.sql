-- 0070_channel_archetype_weight.sql
--
-- Weighted archetype cycling.
--
-- WHY
-- ---
-- The cycle was a flat ring: every archetype a channel curated came up equally
-- often. The owner's actual preference is graded, and he stated it plainly
-- after reviewing 30 generated thumbnails:
--
--   "I want to give the tutorial #1 Best Archetype a higher RNG so that we use
--    it more often. Same, a little lower with the RNG but also still used a
--    lot, I want the tutorial #6. That's also great and the tutorial #4. These
--    are the best ones. Of course then tutorial #8 and tutorial #13 also are
--    good ones."
--
-- and, for the long-form walkthrough channel (Blink Blueprint):
--
--   "for the ultra long form, like the walkthrough channel, primarily used to
--    thumbnail search intent #1, Learn + Beginner"
--
-- Independently corroborated: of the 30 review thumbnails he picked out two as
-- good (#14 and #24) and BOTH were Tutorial #1 Best Archetype. His eye and his
-- instruction agree, which is a good reason to trust the ordering.
--
-- WEIGHT, NOT PRUNING
-- -------------------
-- The unweighted archetypes stay in the ring at weight 1. He curated them
-- deliberately; "use #1 more often" is not "delete the others", and a channel
-- that only ever emits one layout trains the audience to skip it.
--
-- DETERMINISM IS PRESERVED
-- ------------------------
-- Selection stays a pure function of (subject, variant) — see
-- utils/thumbnail/archetype-cycle.ts. Weighting widens each archetype's slice
-- of the hash space; it does not introduce randomness. A regenerate therefore
-- still reproduces the same archetype rather than re-rolling, which is what
-- makes a recorded thumbnail explicable after the fact.
--
-- Hand-written on purpose: drizzle-kit generate is broken in this repo and prod
-- has no migration tracking, so this is applied to prod BY HAND and committing
-- it does not apply it.

ALTER TABLE channel_thumbnail_archetypes
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_thumbnail_archetypes_weight_check'
  ) THEN
    ALTER TABLE channel_thumbnail_archetypes
      ADD CONSTRAINT channel_thumbnail_archetypes_weight_check
      CHECK (weight >= 1 AND weight <= 100);
  END IF;
END $$;

COMMENT ON COLUMN channel_thumbnail_archetypes.weight IS
  'Relative selection frequency within the channel ring. 1 = baseline. Widens '
  'the archetype''s slice of the deterministic hash space; does NOT randomise.';
