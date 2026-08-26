-- 0064_channel_is_primary.sql
--
-- Add an explicit "is this a PRIMARY channel a VA may create ORIGINAL tutorials
-- against?" flag.
--
-- WHY: the friend's single-tenant line has ONE primary channel ("USA Tutorials",
-- English) plus five language counterparts (German/French/Italian/Dutch/Swedish
-- Tutorials). All six currently have accepts_tutorials = true, so the Create
-- picker offers all six — a VA can start an original job against the Italian
-- channel and then pick language German, producing a mismatched, misrouted
-- video. The language channels are only ever meant to receive *translations*
-- generated from the primary via the Localize lane.
--
-- accepts_tutorials cannot answer this: the translate lane routes a translated
-- child to its matching-language channel and still needs those channels to be
-- valid tutorial targets, so we cannot simply flip accepts_tutorials off on them.
-- A separate is_primary flag keeps both truths (see the schema comment).
--
-- The Create channel picker filters on is_primary; Localize/translate routing is
-- unchanged (language + accepts_tutorials).
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this must be applied by hand and
-- committing it does not apply it.
--
-- Defaults FALSE so a newly-created channel is opt-in.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- The friend's one primary origination channel (English / USA Tutorials).
UPDATE channels SET is_primary = true WHERE language = 'en';
