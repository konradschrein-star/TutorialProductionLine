-- 0086: Explicit Tutorial Studio channel -> uploader profile mapping.
--
-- NULL is the safe default: a channel cannot be dispatched until an admin
-- deliberately assigns the provider-neutral key used by the separate uploader.
-- A key may map to only one Studio channel so two language channels cannot
-- silently target the same isolated browser profile.

ALTER TABLE "channels"
  ADD COLUMN IF NOT EXISTS "uploader_channel_key" varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channels_uploader_channel_key_format'
      AND conrelid = 'channels'::regclass
  ) THEN
    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_uploader_channel_key_format"
      CHECK (
        "uploader_channel_key" IS NULL
        OR "uploader_channel_key" ~ '^[a-z][a-z0-9_-]{0,63}$'
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "channels_uploader_channel_key_unique"
  ON "channels" ("uploader_channel_key")
  WHERE "uploader_channel_key" IS NOT NULL;
