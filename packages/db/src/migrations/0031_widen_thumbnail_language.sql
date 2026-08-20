-- 0031_widen_thumbnail_language
-- The localize flow stores free-form language names (e.g. "Portuguese (Brazil)",
-- "Traditional Chinese"), not just ISO codes. The original varchar(10) throws
-- "value too long for type character varying(10)" on insert for longer names,
-- which — before the engine's non-blocking hardening — crashed the thumbnail job
-- with no recorded row. Widen to 64.
--
-- Idempotent: ALTER ... TYPE varchar(64) is a no-op if already 64.
ALTER TABLE "thumbnails" ALTER COLUMN "language" TYPE varchar(64);
