ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "online_seconds_total" bigint DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS "users_last_seen_at_idx" ON "users" ("last_seen_at");
