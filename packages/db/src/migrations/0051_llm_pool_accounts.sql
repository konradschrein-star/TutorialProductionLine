-- 0051: Claude pool accounts + run log (plan P1-6 / §5)
--
-- Multi-account support as ISOLATION, not evasion. `config_dir` is a filesystem
-- path to a CLAUDE_CONFIG_DIR holding an account's OAuth session (written only
-- by an interactive `claude /login`). This table holds NO credential material —
-- no tokens, no keys, ever. Assignment is static (assigned_consumers); there is
-- deliberately no rate-limit rotation.
-- Idempotent.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_pool_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "config_dir" text,
  "plan_label" text,
  "owner_note" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "assigned_consumers" text[] NOT NULL DEFAULT '{}',
  "max_concurrent" integer NOT NULL DEFAULT 2,
  "token_expires_at" timestamptz,
  "last_ok_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_pool_accounts_slug_idx"
  ON "llm_pool_accounts" ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_pool_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_slug" text NOT NULL,
  "consumer" text,
  "format_key" text,
  "endpoint" text NOT NULL,
  "outcome" text NOT NULL,
  "duration_ms" integer,
  "word_count" integer,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_pool_runs_account_created_idx"
  ON "llm_pool_runs" ("account_slug", "created_at" DESC);
--> statement-breakpoint
INSERT INTO "llm_pool_accounts"
  ("slug", "display_name", "config_dir", "plan_label", "owner_note", "enabled", "assigned_consumers", "max_concurrent")
VALUES
  ('root', 'Root (Max 20x, shared with AI-OS)', '/root/.claude', 'max_20x',
   'Shared with the AI-OS at /opt/ai-os. Prefer giving CF its own login (§1.3). Enable only after the VPS P1-0 gate passes.',
   false, '{}', 2),
  ('claude-worker', 'Claude Worker (Max 5x)', '/home/claude-worker/.claude', 'max_5x',
   'Token stale since 2026-06-03 — needs one interactive `claude /login`. Enable after re-login + P1-0.',
   false, ARRAY['tutorial','cf'], 2)
ON CONFLICT ("slug") DO NOTHING;
