-- 0063_channel_accepts_rankings.sql
--
-- Give `channels` an `accepts_rankings` flag so the RANKING lane in Tutorial
-- Studio can offer the right channels.
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 0059 added `accepts_tutorials` to stop the VA channel picker from
-- offering the drama channel, the 'UCxxxxxxxxxxxxxxxx' placeholder, the
-- unconnected Ecom Notebook and the test row alongside the three live ones.
-- The new Ranking tab needs the same protection, but NOT the same list.
--
-- A tier-list channel and a tutorial channel are different products. Reusing
-- `accepts_tutorials` for rankings would mean that the day somebody wants a
-- dedicated ranking channel, they have to set `accepts_tutorials = true` on it
-- — which would immediately offer that channel for tutorials too, and a VA
-- would record a screen capture into a channel that publishes tier lists. One
-- boolean cannot answer two different questions.
--
-- Seeded from `accepts_tutorials` so the three live VA channels (Blink
-- Blueprint, Entrepreneurs Skool, Your VirtualFD) are immediately usable and
-- nobody has to go turn anything on before the lane works. Defaults false, so
-- like 0059 a NEW channel is opt-in and never silently selectable.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS accepts_rankings boolean NOT NULL DEFAULT false;

-- Seed: every channel that already takes tutorial work also takes ranking work.
-- Guarded so re-running this migration cannot re-enable a channel that an
-- operator has since deliberately turned off.
UPDATE channels
   SET accepts_rankings = true
 WHERE accepts_tutorials = true
   AND accepts_rankings = false;
