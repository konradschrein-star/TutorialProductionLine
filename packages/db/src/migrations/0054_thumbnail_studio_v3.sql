-- 0054: Thumbnail Studio v3 — correctness + auditability
--
-- Builds on 0037 (Thumbnail Studio v2). Adds the data model the v3 engine needs
-- to (a) tell Iterate from Regenerate, (b) persist the COMPILED brief so any
-- generation can be explained after the fact, (c) record which backend ACTUALLY
-- served a request and whether a fallback fired (the Nano-Banana-2 -> Seedream
-- silent-downgrade grievance, DECISIONS §2.6), (d) carry per-format thumbnail
-- design doctrine (DECISIONS §3.2.4), and (e) reserve room for the QA-gate
-- scoring columns (§3.2.9, default OFF).
--
-- Hand-written to match repo convention (drizzle-kit generate is stale here).
-- Fully idempotent: safe to re-run.

-- ── Enums ───────────────────────────────────────────────────────────────────
-- How a thumbnail row was produced. This replaces the old implicit behaviour
-- where the ONLY signal was parent_thumbnail_id and Iterate/Regenerate were
-- indistinguishable.
DO $$ BEGIN
  CREATE TYPE "public"."thumbnail_generation_kind" AS ENUM(
    'original', 'variant', 'iterate', 'regenerate', 'edit', 'localize'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- QA-gate verdict (§3.2.9). 'not_reviewed' is the default and the value every
-- existing row keeps.
DO $$ BEGIN
  CREATE TYPE "public"."thumbnail_review_verdict" AS ENUM(
    'strong', 'acceptable', 'reject', 'not_reviewed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The brief-driven prompt author. 'deepseek' stays as an alias for one release
-- so existing rows keep meaning something. ALTER TYPE ... ADD VALUE cannot run
-- inside a DO block and must be a bare statement.
ALTER TYPE "public"."thumbnail_prompt_mode" ADD VALUE IF NOT EXISTS 'authored';
ALTER TYPE "public"."thumbnail_prompt_mode" ADD VALUE IF NOT EXISTS 'manual';

-- ── thumbnail_format_rules ──────────────────────────────────────────────────
-- Per-format thumbnail design doctrine (DECISIONS §3.2.4). One row per FORMAT
-- STRING (varchar, NOT the content_format enum — matches the formats text[]
-- rationale so new formats need no migration; TUTORIAL_STUDIO has no
-- content_templates row at all). Seeded from the research in the plan §A5.
CREATE TABLE IF NOT EXISTS "thumbnail_format_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "format" varchar(64) NOT NULL UNIQUE,
  "display_name" varchar(120) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "layout_archetype" varchar(48),
  "composition" text[] NOT NULL DEFAULT '{}',
  "subject_scale_min" numeric(4,3),
  "subject_scale_max" numeric(4,3),
  -- 0 IS LEGAL and correct for VS / tier-list / before-after (plan §A5.2).
  "text_max_words" integer NOT NULL DEFAULT 5,
  -- true => generate text-free, burn type in afterwards (plan §A5.2, B7).
  "composite_text" boolean NOT NULL DEFAULT false,
  "text_policy" text,
  "subject_policy" text,
  "palette_policy" text,
  -- NEVER 'shocked' — 5% of breakouts, MrBeast A/B killed it (plan §A5.1).
  "emotion_register" varchar(80) NOT NULL DEFAULT 'authentic',
  "gaze_policy" varchar(24) NOT NULL DEFAULT 'direct', -- direct | at_subject | none
  "signature_element" text,
  "negatives" text[] NOT NULL DEFAULT '{}',
  "authoring_notes" text,
  "example_good_paths" text[] NOT NULL DEFAULT '{}',
  "example_bad_paths" text[] NOT NULL DEFAULT '{}',
  "default_archetype_id" uuid REFERENCES "thumbnail_archetypes"("id") ON DELETE SET NULL,
  "rules_version" varchar(32) NOT NULL DEFAULT 'v1',
  -- Why this rule exists. §A5.5 is thin evidence and must SAY so, so Konrad can
  -- overrule it later instead of inheriting cargo cult.
  "evidence_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ── thumbnail_archetypes: lock + origin ─────────────────────────────────────
-- Built-ins that must be cloned rather than edited (same idiom as the subtitle
-- preset lock in 0040), and import provenance for D2's Unassigned filter.
ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "is_locked" boolean NOT NULL DEFAULT false;
ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "origin" varchar(24) NOT NULL DEFAULT 'manual';
COMMENT ON COLUMN "thumbnail_archetypes"."origin" IS
  'imported | manual | bookmark | promoted';

-- ── thumbnails: kind, brief, honest attribution, review ─────────────────────
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "generation_kind" "thumbnail_generation_kind"
    NOT NULL DEFAULT 'original';
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "request_group_id" uuid;
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "variant_index" integer NOT NULL DEFAULT 0;
-- The compiled ThumbnailBrief (plan §B2) — makes iteration history explainable.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "brief" jsonb;
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "rules_version" varchar(32);
-- operator | derived | title_fallback | none (plan §B3). A title_fallback must
-- be VISIBLE — no silent 60-char title pasted onto the image.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "headline_source" varchar(24);
-- The real backend chain and whether a fallback fired, from the gateway — NOT
-- inferred from the ref shape (the old providerFromRef guessed, and wrongly).
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "backend_chain" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "fallback_used" boolean NOT NULL DEFAULT false;
-- QA gate (§3.2.9, default OFF — columns shipped, worker may be unwired).
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "review_score" integer;
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "review_verdict" "thumbnail_review_verdict"
    NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "review_notes" text;
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz;

-- Indexes for variant grouping, selection lookups and the review queue.
CREATE INDEX IF NOT EXISTS "idx_thumbnails_request_group"
  ON "thumbnails" ("request_group_id");
CREATE INDEX IF NOT EXISTS "idx_thumbnails_subject_selected"
  ON "thumbnails" ("subject_kind", "subject_id", "is_selected");
CREATE INDEX IF NOT EXISTS "idx_thumbnails_review_verdict"
  ON "thumbnails" ("review_verdict")
  WHERE "review_verdict" <> 'not_reviewed';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- The only pre-existing lineage semantic. All 57 rows are failed so this is
-- cosmetic, but it keeps the column honest.
UPDATE "thumbnails"
  SET "generation_kind" = 'iterate'
  WHERE "parent_thumbnail_id" IS NOT NULL
    AND "generation_kind" = 'original';
