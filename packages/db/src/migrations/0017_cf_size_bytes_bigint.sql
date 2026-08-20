-- cf_sources.size_bytes was integer (int4), which tops out at ~2.1 GB.
-- A 3.4-hour 1080p Twitch VOD hits 7.8 GB on disk, triggering
-- "value '7875757788' is out of range for type integer" when the worker
-- writes the file size back to the row after Whisper completes.
ALTER TABLE "cf_sources" ALTER COLUMN "size_bytes" TYPE bigint;
