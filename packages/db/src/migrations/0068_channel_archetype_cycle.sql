-- 0068_channel_archetype_cycle.sql
--
-- Per-channel thumbnail archetype CYCLING.
--
-- WHAT WAS WRONG
-- --------------
-- `thumbnail_archetypes.channel_id` is a single nullable column and every row
-- on production is NULL. One column cannot express "this channel cycles through
-- these five templates", which is exactly what the owner asked for:
--
--   "I primarily, from now on, start using: the tutorial #10 for the virtual
--    FD, the tutorial #11, the tutorial #1 best archetype, the tutorial #8, the
--    tutorial #4. That's it. The same cycle of thumbnails I also want to use for
--    entrepreneurs school and for blink blueprint."
--
-- `channel_thumbnail_archetypes` (the many-to-many) already existed and DOES
-- express a set, but it carried no ordering, no notion of a channel default,
-- and no way to say "use these OTHER templates when the tutorial is advanced /
-- beginner". This migration adds those three things and nothing else.
--
-- SHAPE
-- -----
-- Deliberately mirrors `character_channels` (migration 0061), which solved the
-- same problem for the channel's HOST: a link table with a `role`-ish
-- discriminator plus an `is_primary` flag guarded by a PARTIAL UNIQUE INDEX.
-- Two link tables that behave identically is one idiom to learn, not two.
--
--   tier        'base' | 'advanced' | 'beginner'
--               'base' is the everyday cycle. 'advanced' / 'beginner' are
--               DIFFICULTY-SCOPED ADDITIONS, not replacements — see the resolver
--               in packages/db/src/repositories/thumbnail-repository.ts. Kept a
--               varchar rather than a pg enum for the same reason `formats` and
--               `tags` are text[]: a new tier must not need a migration.
--   is_primary  the channel's default/"main" template. At most one per channel,
--               enforced by a partial unique index (NOT by application code).
--   sort_order  the stable ring order of the cycle, so the operator controls it.
--
-- The pre-existing UNIQUE (channel_id, archetype_id) is left in place, so one
-- archetype has exactly ONE tier per channel. That is intentional: an archetype
-- that is simultaneously the base cycle and the advanced set is a configuration
-- nobody can reason about.
--
-- Applied BY HAND on prod (there is no migration tracking on this database).

BEGIN;

ALTER TABLE channel_thumbnail_archetypes
  ADD COLUMN IF NOT EXISTS tier       varchar(24) NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS is_primary boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order integer     NOT NULL DEFAULT 0;

COMMENT ON COLUMN channel_thumbnail_archetypes.tier IS
  'base | advanced | beginner. base = the everyday cycle; the other two are '
  'difficulty-scoped ADDITIONS to it, selected only when the pipeline has a '
  'real difficulty signal for the job.';
COMMENT ON COLUMN channel_thumbnail_archetypes.is_primary IS
  'The channel default/"main" template. At most one per channel (partial '
  'unique index below).';
COMMENT ON COLUMN channel_thumbnail_archetypes.sort_order IS
  'Stable ring order for cycling. Ties fall back to the archetype''s own '
  'sort_order, then name, then id.';

-- At most one primary template per channel. Same idiom as
-- idx_character_channels_one_primary_host in 0061 — the database owns the
-- invariant, not a code path that can be forgotten.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_thumbnail_archetypes_primary
  ON channel_thumbnail_archetypes (channel_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_channel_thumbnail_archetypes_tier
  ON channel_thumbnail_archetypes (channel_id, tier, sort_order);

COMMIT;
