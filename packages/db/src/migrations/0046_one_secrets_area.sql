-- One secrets area: re-key encrypted_secrets from (namespace, capability, provider)
-- to a flat `name` = the environment-variable name, so encrypted_secrets becomes a
-- 1:1 encrypted mirror of .env. The provider registry's providers.key_env_var is the join.
--
-- Hand-written (drizzle-kit generate is broken here — journal stale).
-- Owner: Secrets + Settings, execution session 2026-07-28.
-- Plan: docs/sessions/2026-07-28-plans/secrets-and-settings.md  (S2)
-- Decision: docs/sessions/2026-07-28-DECISIONS.md  D3
--
-- SAFETY: this migration NEVER drops or deletes an encrypted_secrets row. The 6
-- prod rows are the only copy of some keys. It only ADDs columns and backfills.
-- The forensic columns (namespace, capability, provider) are kept NULLABLE for one
-- release; a later migration drops them once the tutorial path is confirmed migrated.

-- ── 1. New columns ──────────────────────────────────────────────────────────
ALTER TABLE "encrypted_secrets" ADD COLUMN IF NOT EXISTS "name"        text;
ALTER TABLE "encrypted_secrets" ADD COLUMN IF NOT EXISTS "kind"        text NOT NULL DEFAULT 'string';  -- 'string' | 'file'
ALTER TABLE "encrypted_secrets" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "encrypted_secrets" ADD COLUMN IF NOT EXISTS "rotated_at"  timestamptz;
ALTER TABLE "encrypted_secrets" ADD COLUMN IF NOT EXISTS "expires_at"  timestamptz;  -- e.g. Fish Audio 2026-08-01

-- ── 2. Backfill `name` from the existing (capability, provider) pairs ────────
-- Explicit mapping table. Any row not matched gets a LEGACY_ name and SURVIVES —
-- it is never dropped.
UPDATE "encrypted_secrets" SET "name" = 'AI33_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('ai33', 'ai33-1', 'ai33_1');
UPDATE "encrypted_secrets" SET "name" = 'AI33_API_KEY_2'
  WHERE "name" IS NULL AND lower("provider") IN ('ai33-2', 'ai33_2');
UPDATE "encrypted_secrets" SET "name" = 'GEMINI_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('google_gemini', 'gemini', 'google-gemini');
UPDATE "encrypted_secrets" SET "name" = 'MINIMAX_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('minimax_tts', 'minimax');
UPDATE "encrypted_secrets" SET "name" = 'INWORLD_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('inworld_tts', 'inworld');
UPDATE "encrypted_secrets" SET "name" = 'ELEVENLABS_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('elevenlabs', 'elevenlabs_official', 'eleven_labs');
UPDATE "encrypted_secrets" SET "name" = 'FISH_AUDIO_API_KEY'
  WHERE "name" IS NULL AND lower("provider") IN ('fish', 'fish_audio', 'fishaudio');

-- Everything unmapped keeps a deterministic, non-destructive name.
UPDATE "encrypted_secrets"
  SET "name" = 'LEGACY_' || upper(coalesce("capability"::text, 'UNK')) || '_' || upper(coalesce("provider"::text, 'UNK'))
  WHERE "name" IS NULL;

-- ── 3. Enforce the new identity ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "uq_encrypted_secrets_name" ON "encrypted_secrets" ("name");
ALTER TABLE "encrypted_secrets" ALTER COLUMN "name" SET NOT NULL;

-- ── 4. Forensic columns become nullable (they used to be NOT NULL) ──────────
-- The (namespace, capability, provider) slot is no longer the identity; `name` is.
ALTER TABLE "encrypted_secrets" ALTER COLUMN "namespace"  DROP NOT NULL;
ALTER TABLE "encrypted_secrets" ALTER COLUMN "capability" DROP NOT NULL;
ALTER TABLE "encrypted_secrets" ALTER COLUMN "provider"   DROP NOT NULL;

-- ── 5. Expiry seed (visible so System Health can alert; NEVER guessed elsewhere)
UPDATE "encrypted_secrets" SET "expires_at" = '2026-08-01T00:00:00Z'
  WHERE "name" = 'FISH_AUDIO_API_KEY' AND "expires_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSE (on paper, do not run blindly):
--   ALTER TABLE encrypted_secrets ALTER COLUMN namespace  SET NOT NULL;
--   ALTER TABLE encrypted_secrets ALTER COLUMN capability SET NOT NULL;
--   ALTER TABLE encrypted_secrets ALTER COLUMN provider   SET NOT NULL;
--   DROP INDEX IF EXISTS uq_encrypted_secrets_name;
--   ALTER TABLE encrypted_secrets DROP COLUMN name, DROP COLUMN kind,
--     DROP COLUMN description, DROP COLUMN rotated_at, DROP COLUMN expires_at;
