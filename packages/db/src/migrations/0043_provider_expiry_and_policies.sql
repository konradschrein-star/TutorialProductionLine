-- Provider expiry clocks + capability fallback policies.
-- Hand-written (drizzle-kit generate is broken here — journal stale at 0012).
-- Owner: System Health / provider registry, execution session 2026-07-28.
-- Plan: docs/sessions/2026-07-28-plans/system-health.md  (Phase B2 + Phase C)
--
-- NOTE ON system_events: the plan proposed a system_events table for provider
-- event emission. That table ALREADY EXISTS (schema/system-events.ts, LISTEN/
-- NOTIFY log). Provider events (provider.expiring / provider.expired /
-- provider.down / capability.no_route / fallback.used) reuse it — job_id is
-- nullable there, so provider-scoped events fit without a schema change. No
-- second notification system is created.

-- ── provider_expiries ───────────────────────────────────────────────────────
-- One provider may have SEVERAL independent clocks (subscription, api_key,
-- licence, cookie_file, oauth_token, credit_balance). expires_at is NEVER
-- guessed: source='manual' + NULL expires_at = "unknown, ask the operator".
CREATE TABLE IF NOT EXISTS "provider_expiries" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_key"     text NOT NULL,
  "kind"             text NOT NULL,
  "label"            text NOT NULL,
  "expires_at"       timestamptz,
  "source"           text NOT NULL DEFAULT 'manual',
  "warn_days_before" integer NOT NULL DEFAULT 14,
  "last_verified_at" timestamptz,
  "evidence"         jsonb,
  "note"             text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_expiries_provider"
  ON "provider_expiries" ("provider_key");
CREATE INDEX IF NOT EXISTS "idx_provider_expiries_expires"
  ON "provider_expiries" ("expires_at");
-- One clock per (provider, kind, label) so seeding is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_expiries_identity"
  ON "provider_expiries" ("provider_key", "kind", "label");

-- ── capability_policies ─────────────────────────────────────────────────────
-- "Fail instead of degrading." strict=true => never use chain position > 1;
-- the gateway throws with the full chain instead of silently downgrading.
-- consumer NULL = the global policy for the capability; non-null = an override.
CREATE TABLE IF NOT EXISTS "capability_policies" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "capability"         text NOT NULL,
  "consumer"           text,
  "strict"             boolean NOT NULL DEFAULT false,
  "max_fallback_depth" integer,
  "require_ack"        boolean NOT NULL DEFAULT false,
  "note"               text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_capability_policies_lookup"
  ON "capability_policies" ("capability", "consumer");
-- Two partial unique indexes (global vs consumer), matching the 0038 convention
-- (partial unique rather than NULLS NOT DISTINCT, so this works pre-PG15).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_capability_policies_global"
  ON "capability_policies" ("capability")
  WHERE "consumer" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_capability_policies_consumer"
  ON "capability_policies" ("capability", "consumer")
  WHERE "consumer" IS NOT NULL;
