-- Compute-node registry — render / GPU topology (§2.5).
-- Hand-written (drizzle-kit generate is broken here — journal stale at 0012).
-- Owner: System Health / provider registry, execution session 2026-07-28.
-- Plan: docs/sessions/2026-07-28-plans/system-health.md  (Phase F1)
--
-- SECURITY GATE (plan §0): the VPS was compromised (root-level cryptominer +
-- completed credential-harvest stage). Building this registry is safe, but NO
-- home node may be tunnelled to the VPS until the box is confirmed clean and
-- every key rotated. `enabled` DEFAULTS FALSE for exactly this reason — a node
-- does nothing until an operator deliberately enables it post-remediation.

-- ── compute_nodes ───────────────────────────────────────────────────────────
-- Status is DERIVED from last_heartbeat_at, never stored.
CREATE TABLE IF NOT EXISTS "compute_nodes" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                text NOT NULL UNIQUE,
  "kind"                text NOT NULL,                          -- vps|desktop|laptop|vm|gpu_box
  "enabled"             boolean NOT NULL DEFAULT false,         -- gated on §0 remediation
  "capabilities"        text[] NOT NULL DEFAULT '{}'::text[],
  "capacity"            jsonb,                                  -- per-capability max_concurrent
  "budget"              jsonb,                                  -- cpu_pct, mem_gb, quiet_hours
  "last_heartbeat_at"   timestamptz,
  "agent_version"       text,
  "os"                  text,
  "cpu_model"           text,
  "cpu_cores"           integer,
  "gpu_model"           text,
  "vram_gb"             integer,
  "drain_requested_at"  timestamptz,
  "note"                text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_compute_nodes_enabled"
  ON "compute_nodes" ("enabled");
CREATE INDEX IF NOT EXISTS "idx_compute_nodes_heartbeat"
  ON "compute_nodes" ("last_heartbeat_at");

-- ── compute_node_heartbeats ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "compute_node_heartbeats" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id"     uuid NOT NULL,
  "cpu_pct"     integer,
  "mem_gb"      integer,
  "gpu_pct"     integer,
  "queue_depth" integer,
  "metrics"     jsonb,
  "reported_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_compute_node_heartbeats_node_time"
  ON "compute_node_heartbeats" ("node_id", "reported_at" DESC);
