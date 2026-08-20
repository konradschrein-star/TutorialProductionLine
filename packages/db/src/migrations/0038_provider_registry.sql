-- Provider / capability registry.
-- Hand-written (drizzle-kit generate is broken in this repo — journal stale at 0012).
-- Owner: Agent H, overnight session 2026-07-28.
-- Spec: docs/sessions/2026-07-28-overnight-plan.md (Agent H) + docs/PROVIDER_INVENTORY.md
--
-- NOTE: NO CREDENTIALS ARE STORED HERE. `key_env_var` holds only the NAME of
-- the environment variable that carries a key. Presence is computed at runtime.

-- ── providers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "providers" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"             text NOT NULL UNIQUE,
  "display_name"    text NOT NULL,
  "vendor"          text,
  "description"     text,
  "capabilities"    text[] NOT NULL DEFAULT '{}'::text[],
  "base_url"        text,
  "docs_url"        text,
  "key_env_var"     text,
  "url_env_var"     text,
  "cost_tier"       text NOT NULL DEFAULT 'unknown',
  "plan_state"      text NOT NULL DEFAULT 'unknown',
  "plan_expires_at" timestamptz,
  "plan_note"       text,
  "enabled"         boolean NOT NULL DEFAULT true,
  "max_concurrent"  integer,
  "deprecated"      boolean NOT NULL DEFAULT false,
  "notes"           text,
  "sort_order"      integer,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_providers_enabled"    ON "providers" ("enabled");
CREATE INDEX IF NOT EXISTS "idx_providers_plan_state" ON "providers" ("plan_state");

-- ── provider_capability_links (the ordered chains) ──────────────────────────
-- position 1 = primary; later positions are fallbacks. enabled = false means
-- that hop is switched OFF and is never used: fallback is opt-in.
-- consumer NULL = global chain; a non-null consumer fully replaces it.
CREATE TABLE IF NOT EXISTS "provider_capability_links" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "capability"   text NOT NULL,
  "provider_key" text NOT NULL,
  "position"     integer NOT NULL,
  "enabled"      boolean NOT NULL DEFAULT true,
  "consumer"     text,
  "note"         text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_links_capability"
  ON "provider_capability_links" ("capability", "position");

-- Two partial unique indexes rather than NULLS NOT DISTINCT, so this works on
-- Postgres < 15 as well. Together they dedupe both the global chain
-- (consumer IS NULL) and each consumer override chain.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_links_global"
  ON "provider_capability_links" ("capability", "provider_key")
  WHERE "consumer" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_links_consumer"
  ON "provider_capability_links" ("capability", "consumer", "provider_key")
  WHERE "consumer" IS NOT NULL;

-- ── provider_consumer_priorities ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "provider_consumer_priorities" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "consumer"       text NOT NULL,
  "capability"     text,
  "priority"       integer NOT NULL,
  "max_concurrent" integer,
  "note"           text,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_consumer_priority_all"
  ON "provider_consumer_priorities" ("consumer")
  WHERE "capability" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_consumer_priority_cap"
  ON "provider_consumer_priorities" ("consumer", "capability")
  WHERE "capability" IS NOT NULL;

-- ── provider_health_checks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "provider_health_checks" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_key" text NOT NULL,
  "status"       text NOT NULL,
  "latency_ms"   integer,
  "http_status"  integer,
  "detail"       jsonb,
  "error"        text,
  "checked_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_health_provider_time"
  ON "provider_health_checks" ("provider_key", "checked_at" DESC);

-- ── provider_usage_events ───────────────────────────────────────────────────
-- One row per gateway call, recording WHO ACTUALLY SERVED IT.
-- is_fallback = true is the Nano-Banana-2 → Seedream 4.5 detector.
CREATE TABLE IF NOT EXISTS "provider_usage_events" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "capability"         text NOT NULL,
  "consumer"           text NOT NULL,
  "requested_provider" text,
  "served_provider"    text NOT NULL,
  "is_fallback"        boolean NOT NULL DEFAULT false,
  "fallback_depth"     integer NOT NULL DEFAULT 0,
  "outcome"            text NOT NULL,
  "latency_ms"         integer,
  "job_id"             text,
  "context"            text,
  "error"              text,
  "attempted_chain"    text[],
  "created_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_usage_created"
  ON "provider_usage_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_provider_usage_fallback"
  ON "provider_usage_events" ("is_fallback", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_provider_usage_served"
  ON "provider_usage_events" ("served_provider", "created_at" DESC);
