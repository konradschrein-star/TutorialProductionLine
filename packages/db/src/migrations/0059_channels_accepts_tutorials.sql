-- 0059_channels_accepts_tutorials.sql
--
-- Add an explicit "is this channel currently receiving tutorial videos?" flag.
--
-- WHY: the channels table holds 7 rows, of which only 3 are live tutorial
-- channels. The rest are a drama channel, a placeholder with the literal
-- youtube_channel_id 'UCxxxxxxxxxxxxxxxx', an unconnected 'PENDING_ecom-notebook',
-- and a test row. Nothing in the schema distinguished them, so the job-creation
-- picker offered all 7 and the correct answer was tribal knowledge.
--
-- This matters more than it looks: 1,921 of 2,006 completed tutorials have
-- channel_id NULL (96%), because the picker defaulted to "— None —" and was
-- labelled "optional". A NULL channel means the Drive folder is literally
-- named _no-channel, thumbnail generation is skipped entirely, and nobody can
-- tell which of three channels a finished video belongs to — which is the whole
-- point of the pipeline.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo, and
-- production has NO migration tracking, so this must be applied by hand and
-- committing it does not apply it.
--
-- Defaults to FALSE so a newly-created channel is opt-in rather than silently
-- appearing in the VA's picker.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS accepts_tutorials boolean NOT NULL DEFAULT false;

-- The three channels Konrad confirmed as live on 2026-08-03.
UPDATE channels SET accepts_tutorials = true
WHERE youtube_channel_id IN (
  'UC6ITnyrlE7dZXf010Fz-1ew',  -- Your VirtualFD
  'UCML-9xtrt20xxSRkW1WApBQ',  -- Entrepreneurs Skool
  'UCh7-FIWngYyxM2Ra6ELrF3g'   -- Blink Blueprint
);
