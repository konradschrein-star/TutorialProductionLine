-- 0055: Thumbnail auto-pilot policies (DECISIONS §3.2.8, §3.2.9, §2.6)
--
-- Per-(format, channel) automation policy: whether auto-generation runs at
-- AWAITING_UPLOADER, how many variants, whether the optional QA gate is on
-- (DEFAULT OFF), which selection rule picks the winner, and what happens on a
-- provider fallback (allow | warn | fail — the opt-in half of §2.6).
--
-- channel_id NULL = the format default (mirrors the global-archetype
-- convention). A partial unique index enforces one default row per format.
--
-- Hand-written, idempotent.

CREATE TABLE IF NOT EXISTS "thumbnail_autopilot_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "format" varchar(64) NOT NULL,
  "channel_id" uuid REFERENCES "channels"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT true,
  -- 3 = YouTube Test & Compare cap; small deltas are undetectable (plan §A5.4).
  "variant_count" integer NOT NULL DEFAULT 3,
  "qa_enabled" boolean NOT NULL DEFAULT false, -- §3.2.9 DEFAULT OFF
  "qa_min_score" integer NOT NULL DEFAULT 60,
  "qa_max_retries" integer NOT NULL DEFAULT 1,
  -- qa_best_score | first_completed  (never a random pick — plan §B6)
  "selection_rule" varchar(32) NOT NULL DEFAULT 'qa_best_score',
  -- allow | warn | fail  (§2.6 — visible + opt-in)
  "on_fallback" varchar(16) NOT NULL DEFAULT 'warn',
  "prompt_mode" "thumbnail_prompt_mode" NOT NULL DEFAULT 'programmatic',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- One policy per (format, channel). The NULL-channel default needs a partial
-- unique index because NULLs are distinct under a plain UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_thumbnail_autopilot_format_channel"
  ON "thumbnail_autopilot_policies" ("format", "channel_id")
  WHERE "channel_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_thumbnail_autopilot_format_default"
  ON "thumbnail_autopilot_policies" ("format")
  WHERE "channel_id" IS NULL;
