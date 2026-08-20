-- 0037: Thumbnail Studio v2
--
-- Rebuilds the global thumbnail system around the ported "Thumbnail Creator V2"
-- (konradschrein-star/thumbnail-tool) data model, which is archetype-first.
--
-- What changes and why:
--   1. Archetypes become GLOBAL BY DEFAULT. `channel_id` is added and is
--      NULLABLE — NULL means "usable by every channel". The old model made an
--      archetype reachable only through the `channel_thumbnail_archetypes`
--      link table, so the ~44 archetypes imported from the old tool (which had
--      no channel) would have been invisible to the generator. The link table
--      is KEPT: it now means "this channel explicitly opted into this
--      archetype", which still narrows the LRU candidate pool when a channel
--      has curated one.
--   2. Aspect ratio + resolution become first-class, defaulting to 16:9 / 1k
--      (the operator's stated default) and overridable per archetype and per
--      generation. They were previously hardcoded in the worker.
--   3. `thumbnails.channel_id` becomes NULLABLE so the Studio can generate
--      ad-hoc thumbnails that do not belong to any channel or job.
--   4. Generated thumbnails become reusable as reference images (iteration
--      lineage via `parent_thumbnail_id`, extra references, pinning).
--   5. `source_key` gives the importer an idempotency handle so re-running the
--      seed neither duplicates nor clobbers hand-edited archetypes.
--
-- Hand-written to match repo convention (drizzle-kit generate is stale).
-- Fully idempotent: safe to re-run.

-- ── Enum: add the 'studio' subject kind ─────────────────────────────────────
-- Ad-hoc thumbnails generated from the Studio UI that are not tied to a
-- content_job/tutorial_job. NOTE: ALTER TYPE ... ADD VALUE cannot run inside a
-- DO block or a function, so this is a bare statement. IF NOT EXISTS makes it
-- idempotent (PostgreSQL 10+).
ALTER TYPE "public"."thumbnail_subject_kind" ADD VALUE IF NOT EXISTS 'studio';

-- ── thumbnail_archetypes ────────────────────────────────────────────────────
ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "channel_id" uuid REFERENCES "channels"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "thumbnail_archetypes"."channel_id" IS
  'NULL = global archetype, available to every channel. Non-NULL = owned by that channel only.';

ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "description" text;

ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "aspect_ratio" varchar(16) DEFAULT '16:9' NOT NULL;

ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "resolution" varchar(16) DEFAULT '1k' NOT NULL;

-- Additional i2i reference images beyond the primary `reference_image_path`
-- (e.g. a second layout example, or a product shot the model should honour).
ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "extra_reference_paths" text[] DEFAULT '{}' NOT NULL;

-- Provenance / import idempotency key, e.g. 'thumbnail-tool:cmo7de6u3000defe0'.
ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "source_key" varchar(200);

ALTER TABLE "thumbnail_archetypes"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_thumbnail_archetypes_source_key"
  ON "thumbnail_archetypes" ("source_key")
  WHERE "source_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_thumbnail_archetypes_channel"
  ON "thumbnail_archetypes" ("channel_id");

-- Global archetypes are the hot path for the generator's candidate lookup.
CREATE INDEX IF NOT EXISTS "idx_thumbnail_archetypes_global_active"
  ON "thumbnail_archetypes" ("is_active")
  WHERE "channel_id" IS NULL;

-- ── thumbnails ──────────────────────────────────────────────────────────────
-- Studio-generated thumbnails need not belong to a channel.
ALTER TABLE "thumbnails" ALTER COLUMN "channel_id" DROP NOT NULL;

ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "aspect_ratio" varchar(16) DEFAULT '16:9' NOT NULL;

ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "resolution" varchar(16) DEFAULT '1k' NOT NULL;

-- Human-facing inputs, kept so a generation can be replayed/understood without
-- reverse-engineering `prompt_used`.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "title" varchar(300);

ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "headline_text" varchar(300);

ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "topic" text;

-- Iteration lineage: "regenerate this one with a tweak".
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "parent_thumbnail_id" uuid REFERENCES "thumbnails"("id") ON DELETE SET NULL;

-- Reference images supplied for THIS generation on top of the archetype's.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "extra_reference_paths" text[] DEFAULT '{}' NOT NULL;

-- Operator kept this one in the reusable reference library.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL;

ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

-- Which backend actually served the request, recorded verbatim so a silent
-- downgrade (the Nano-Banana-2 -> Seedream incident) is visible after the fact.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "requested_backend" varchar(32);

-- Library / history view: newest first across everything.
CREATE INDEX IF NOT EXISTS "idx_thumbnails_created_at"
  ON "thumbnails" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_thumbnails_parent"
  ON "thumbnails" ("parent_thumbnail_id");

-- Reference picker: completed images only, newest first.
CREATE INDEX IF NOT EXISTS "idx_thumbnails_completed"
  ON "thumbnails" ("status", "created_at" DESC)
  WHERE "output_path" IS NOT NULL;
