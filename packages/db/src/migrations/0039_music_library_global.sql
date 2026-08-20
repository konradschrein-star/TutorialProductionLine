-- 0039 — Global Music System.
--
-- Hand-written SQL (drizzle-kit generate is broken in this repo — journal stale
-- at 0012). Owner: Agent M, overnight session 2026-07-28.
--
-- Three things happen here:
--   1. `music_library` grows real provenance/attribution metadata. The headline
--      ask is `creator` — "so we can remember which one was Suno" and so that,
--      once operations industrialise, credits can be generated automatically.
--   2. Backfill of `creator`/`source` for the 24 pre-existing rows, based on
--      verified evidence (see the BACKFILL section for the reasoning).
--   3. Collections + assignments, so any content format or channel can draw
--      from the library. This mirrors the subtitle system's
--      preset -> preset_assignments(format, channel_id) shape on purpose.

-- ---------------------------------------------------------------------------
-- 1. music_library: provenance, licensing, tagging
-- ---------------------------------------------------------------------------

ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "creator" varchar(200);
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "source" varchar(32) NOT NULL DEFAULT 'unknown';
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "license" varchar(120);
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "attribution_required" boolean NOT NULL DEFAULT false;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "attribution_text" text;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "mood" text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "bpm" integer;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "original_filename" varchar(255);
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "file_bytes" bigint;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "generation_prompt" text;
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "generation_provider" varchar(50);
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "generation_task_id" varchar(100);
ALTER TABLE "music_library" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

-- `source` is a closed set. Keep it enforced in the DB so a typo can never
-- quietly mislabel where a track came from.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'music_library_source_check'
  ) THEN
    ALTER TABLE "music_library"
      ADD CONSTRAINT "music_library_source_check"
      CHECK ("source" IN ('suno_ai33', 'minimax_ai33', 'upload', 'seed', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_music_library_source" ON "music_library" ("source");
CREATE INDEX IF NOT EXISTS "idx_music_library_creator" ON "music_library" ("creator");
CREATE INDEX IF NOT EXISTS "idx_music_library_active" ON "music_library" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_music_library_genre" ON "music_library" ("genre");

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — evidence-based, deliberately conservative
-- ---------------------------------------------------------------------------
--
-- Production `music_library` held 24 rows at the time of writing. They are NOT
-- homogeneous, so they are NOT all labelled Suno:
--
--   a) 19 rows named 'Space Documentary%' with file_path under
--      /opt/content-forge/media/space-video/. Evidence they are Suno:
--        - the only writer of that name+path was
--          apps/worker-orchestrator/src/processors/space-video/assemble.ts,
--          which set `title: "Space Documentary"` and called generateSunoMusic()
--          (apps/worker-orchestrator/src/utils/ai33-suno.ts -> AI33
--          /v1s/task/music-generation).
--        - introduced by commit 6b7fced4 "feat(space-video): ElevenLabs TTS,
--          Suno music gen, parameterize music volume"; the pipeline was later
--          deleted in 68c5cd71.
--      -> creator = 'Suno (AI33)', source = 'suno_ai33'.
--
--   b) 5 rows that are seeded placeholders, not generated audio:
--      'Upbeat Corporate', 'Dramatic Intro', 'Tech & Innovation',
--      'Calm Background', 'Ambient Space'. Their file_paths point at
--      /music/*.mp3 and /opt/content-forge/media/music/calm_background.mp3 —
--      a directory layout nothing in the pipeline ever wrote to, and two of
--      them share one identical file. These are demo seed rows.
--      -> source = 'seed', creator LEFT NULL on purpose. Mislabelling a seed
--         row as Suno would poison the credits export later.
--
-- Matching is by file_path shape (stable) rather than by name text.

UPDATE "music_library"
SET "creator" = 'Suno (AI33)',
    "source" = 'suno_ai33',
    "generation_provider" = 'ai33:suno',
    "license" = 'Suno subscription — commercial use',
    "attribution_required" = false
WHERE "source" = 'unknown'
  AND "file_path" LIKE '%/space-video/%';

UPDATE "music_library"
SET "source" = 'seed'
WHERE "source" = 'unknown'
  AND "file_path" NOT LIKE '%/space-video/%';

-- ---------------------------------------------------------------------------
-- 3. Collections + assignments (global consumption by any format/channel)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "music_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(120) NOT NULL UNIQUE,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "music_collection_tracks" (
  "collection_id" uuid NOT NULL REFERENCES "music_collections"("id") ON DELETE CASCADE,
  "track_id" uuid NOT NULL REFERENCES "music_library"("id") ON DELETE CASCADE,
  "sort_order" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("collection_id", "track_id")
);

CREATE INDEX IF NOT EXISTS "idx_music_collection_tracks_track"
  ON "music_collection_tracks" ("track_id");

CREATE TABLE IF NOT EXISTS "music_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "collection_id" uuid NOT NULL REFERENCES "music_collections"("id") ON DELETE CASCADE,
  -- NULL format = applies to every format. NULL channel_id = every channel.
  -- Both NULL = the global default bed.
  "format" varchar(50),
  "channel_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "selection_mode" varchar(20) NOT NULL DEFAULT 'random',
  "volume_db" real NOT NULL DEFAULT -18,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'music_assignments_selection_mode_check'
  ) THEN
    ALTER TABLE "music_assignments"
      ADD CONSTRAINT "music_assignments_selection_mode_check"
      CHECK ("selection_mode" IN ('random', 'sequential', 'longest_first'));
  END IF;
END $$;

-- One assignment per scope. A plain UNIQUE(format, channel_id) would NOT work:
-- Postgres treats NULLs as distinct, so it would happily allow two competing
-- global defaults. Coalescing into sentinels closes that hole for all four
-- scope shapes (global / format / channel / format+channel).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_music_assignments_scope"
  ON "music_assignments" (
    COALESCE("format", '*'),
    COALESCE("channel_id", '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS "idx_music_assignments_collection"
  ON "music_assignments" ("collection_id");

-- ---------------------------------------------------------------------------
-- 4. music_generations — durable record of every on-demand generation
-- ---------------------------------------------------------------------------
--
-- Suno runs for minutes. Before this table, a generation was fired detached
-- and its outcome was visible only in a log line: a 429 or an out-of-credit
-- failure looked exactly like "still working". AI33 has a documented history
-- of queue saturation (12/10 tasks queued, every endpoint 429ing), so failure
-- has to be a first-class, queryable state — never a silent nothing.

CREATE TABLE IF NOT EXISTS "music_generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" varchar(50) NOT NULL DEFAULT 'ai33:suno',
  "provider_task_id" varchar(100),
  "prompt" text NOT NULL,
  "title" varchar(200),
  "instrumental" boolean NOT NULL DEFAULT true,
  "genre" varchar(100),
  "format" varchar(50),
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  -- Machine-readable failure class so the UI can say *why*, e.g.
  -- 'rate_limited' / 'server_busy' / 'no_credits' / 'auth' / 'timeout'.
  "error_code" varchar(50),
  "error_message" text,
  -- Tracks produced. Suno returns TWO clips per task; we ingest both.
  "track_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "credit_cost" integer,
  "requested_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'music_generations_status_check'
  ) THEN
    ALTER TABLE "music_generations"
      ADD CONSTRAINT "music_generations_status_check"
      CHECK ("status" IN ('queued', 'running', 'done', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_music_generations_status"
  ON "music_generations" ("status");
CREATE INDEX IF NOT EXISTS "idx_music_generations_created"
  ON "music_generations" ("created_at" DESC);
