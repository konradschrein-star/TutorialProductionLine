-- Settings rework: drop the dead settings sections and the never-used ai_services
-- store; rewrite the storage limit from megabytes to bytes.
--
-- Hand-written (drizzle-kit generate is broken here — journal stale).
-- Owner: Secrets + Settings, execution session 2026-07-28.
-- Plan: docs/sessions/2026-07-28-plans/secrets-and-settings.md  (S2 step 3, T5)
-- Decision: docs/sessions/2026-07-28-DECISIONS.md  §3.3
--
-- Prod is NULL in every one of these columns (verified by the previous session:
-- nothing reads them), so every DROP is a no-op there. dev/staging rows may exist.

-- ── 1. Storage: megabytes → bytes, before the column set changes ────────────
-- Rewrite the jsonb in place: maxFileSizeMb (MB) → maxUploadBytes (bytes).
-- 500 MB default was "idiotic" (Konrad); new default 50 GB is applied in the Zod
-- schema, not here — here we only preserve any value a row already carries.
UPDATE "system_settings"
  SET "storage" = jsonb_set(
        ("storage" - 'maxFileSizeMb'),
        '{maxUploadBytes}',
        to_jsonb((("storage" ->> 'maxFileSizeMb')::bigint) * 1048576)
      )
  WHERE "storage" IS NOT NULL
    AND "storage" ? 'maxFileSizeMb'
    AND ("storage" ->> 'maxFileSizeMb') ~ '^[0-9]+$';

-- ── 2. Drop the dead / relocated settings sections ──────────────────────────
--   ai_services : never worked, nothing reads it; secrets live in encrypted_secrets now.
--   general     : deleted per §3.3 (nothing reads systemName/timezone/language).
--   pipeline    : "default render engine is nonsense" — per-format, not global.
--   rendering   : per-format, not a platform-global decision.
--   channels    : a dedicated /channels page exists.
--   security    : "what security is there to set? Nothing."
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "ai_services";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "general";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "pipeline";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "rendering";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "channels";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "security";

-- KEPT (reworked, not deleted): storage, notifications.

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERSE (on paper, do not run blindly — the dropped data is not recoverable):
--   ALTER TABLE system_settings ADD COLUMN ai_services jsonb;
--   ALTER TABLE system_settings ADD COLUMN general     jsonb;
--   ALTER TABLE system_settings ADD COLUMN pipeline    jsonb;
--   ALTER TABLE system_settings ADD COLUMN rendering   jsonb;
--   ALTER TABLE system_settings ADD COLUMN channels    jsonb;
--   ALTER TABLE system_settings ADD COLUMN security    jsonb;
--   UPDATE system_settings SET storage = jsonb_set(
--     (storage - 'maxUploadBytes'), '{maxFileSizeMb}',
--     to_jsonb(((storage->>'maxUploadBytes')::bigint) / 1048576)) WHERE storage ? 'maxUploadBytes';
