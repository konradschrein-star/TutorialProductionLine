-- 0056: Thumbnail deterministic edits (§3.2.7, plan B7) + YouTube bookmarks
--       (§3.2.10, plan B9).
--
-- Both are LATER-phase features by schedule; the tables are created now so no
-- second migration is needed when the workers/UI land. Neither is wired into
-- the automatic pipeline.
--
-- thumbnail_edits: a deterministic overlay edit document (crop rect, text
-- layers, logo placement, brightness/contrast) rendered by Sharp/node-canvas
-- into a derived generation_kind='edit' row. Deterministic, reproducible, no
-- provider call — the only reliable way to get EXACT typography (diffusion
-- models still mangle lettering).
--
-- thumbnail_bookmarks: outlier thumbnails captured from YouTube, the front half
-- of the 1of10 "research -> reference -> generate" loop. Cheapest ingest is a
-- pasted YouTube URL (server fetches i.ytimg.com/vi/<id>/maxresdefault.jpg).
--
-- Hand-written, idempotent.

CREATE TABLE IF NOT EXISTS "thumbnail_edits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thumbnail_id" uuid NOT NULL REFERENCES "thumbnails"("id") ON DELETE CASCADE,
  "doc" jsonb NOT NULL,
  "output_path" text,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "created_by" varchar(120),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_thumbnail_edits_thumbnail"
  ON "thumbnail_edits" ("thumbnail_id");

CREATE TABLE IF NOT EXISTS "thumbnail_bookmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_url" text NOT NULL,
  "video_id" varchar(32),
  "channel_name" varchar(200),
  "title" text,
  "image_path" text NOT NULL,
  "notes" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "captured_by" varchar(120),
  "captured_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_thumbnail_bookmarks_video"
  ON "thumbnail_bookmarks" ("video_id");

-- A generated thumbnail may be seeded FROM a bookmark used as a reference.
ALTER TABLE "thumbnails"
  ADD COLUMN IF NOT EXISTS "from_bookmark_id" uuid
    REFERENCES "thumbnail_bookmarks"("id") ON DELETE SET NULL;
