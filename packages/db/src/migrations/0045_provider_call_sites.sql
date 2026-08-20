-- Provider call-site index + observed-consumer rollup (§2.4 "used where").
-- Hand-written (drizzle-kit generate is broken here — journal stale at 0012).
-- Owner: System Health / provider registry, execution session 2026-07-28.
-- Plan: docs/sessions/2026-07-28-plans/system-health.md  (Phase E)
--
-- Two sources of truth for "where is this provider used", because each catches
-- what the other misses:
--   provider_call_sites  STATIC  — import sites (catches never-run code)
--   provider_consumers   OBSERVED — rolled up from provider_usage_events
--                                    (the only provably-current source; drives
--                                     the "Reassign consumers" control)

-- ── provider_call_sites ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "provider_call_sites" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_key" text NOT NULL,
  "file"         text NOT NULL,
  "line"         integer NOT NULL,
  "symbol"       text,
  "kind"         text NOT NULL DEFAULT 'import',   -- import|gateway-exempt|dynamic
  "indexed_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_call_sites_provider"
  ON "provider_call_sites" ("provider_key");

-- ── provider_consumers (observed rollup) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "provider_consumers" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_key" text NOT NULL,
  "consumer"     text NOT NULL,
  "capability"   text NOT NULL,
  "calls_24h"    integer NOT NULL DEFAULT 0,
  "last_seen_at" timestamptz,
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_provider_consumers_provider"
  ON "provider_consumers" ("provider_key");
CREATE INDEX IF NOT EXISTS "idx_provider_consumers_consumer"
  ON "provider_consumers" ("consumer");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provider_consumers_identity"
  ON "provider_consumers" ("provider_key", "consumer", "capability");
