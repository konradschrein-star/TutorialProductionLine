-- Global clip library: structured source identity, expanded clip-type
-- taxonomy, dedup metadata, storage-backend hook, per-library label cap.
-- All additive. Safe to re-run.

-- ── 1. Extend clip_type enum with cross-format taxonomy ──────────────────
-- Postgres requires each ADD VALUE in its own transaction. The DO blocks
-- swallow duplicate_object so re-runs are idempotent.
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_real';            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_news';            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_documentary';     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_stock';           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_animation_2d';    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_animation_3d';    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_vfx_heavy';       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'footage_archival';        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE clip_type ADD VALUE 'screen_recording';        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. New enums ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE source_kind AS ENUM ('movie','series','youtube','stock','upload','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE storage_backend AS ENUM ('local','nas','s3');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. clip_libraries: storage hook + per-library label cap ──────────────
ALTER TABLE clip_libraries
  ADD COLUMN IF NOT EXISTS storage_backend storage_backend NOT NULL DEFAULT 'local',
  -- Interpreted per backend: 'local' = absolute filesystem path; 'nas' =
  -- nas://host/share/...; 's3' = bucket. NULL falls back to LOCAL_MEDIA_ROOT.
  ADD COLUMN IF NOT EXISTS storage_root TEXT,
  -- Soft cap consumed by the clip-label worker via in-process semaphore.
  -- Lets a fragile source library throttle without changing worker config.
  ADD COLUMN IF NOT EXISTS labeling_concurrency SMALLINT NOT NULL DEFAULT 4,
  -- Reserved for the CLIP visual-embedding sidecar (separate PR). OFF by
  -- default; turn on for Vidrush-style libraries where vibe matters most.
  ADD COLUMN IF NOT EXISTS use_visual_embedding BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. source_videos: structured source identity ─────────────────────────
ALTER TABLE source_videos
  ADD COLUMN IF NOT EXISTS source_kind         source_kind NOT NULL DEFAULT 'other',
  -- kebab-case stable identifier: 'star-wars-episode-iv', 'the-clone-wars',
  -- 'harry-potter-and-the-sorcerers-stone'.
  ADD COLUMN IF NOT EXISTS work_slug           VARCHAR(120),
  ADD COLUMN IF NOT EXISTS work_title          VARCHAR(300),
  -- Multi-part movie disc (LotR EE 1/2/3); NULL for single-file movies.
  ADD COLUMN IF NOT EXISTS work_part           SMALLINT,
  ADD COLUMN IF NOT EXISTS season              SMALLINT,
  ADD COLUMN IF NOT EXISTS episode             SMALLINT,
  -- YouTube id widened past 11 chars to accommodate Shorts and edge cases.
  ADD COLUMN IF NOT EXISTS youtube_id          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS external_provider   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS external_id         VARCHAR(200),
  -- Prefix that all clips inherit. Composed in app code per source_kind:
  --   movie   → slug + ('/' + work_part)?
  --   series  → slug + '/' + season + '/' + episode
  --   youtube → youtube_id
  --   stock   → provider + '/' + external_id
  --   other   → slug + '/' + external_id
  ADD COLUMN IF NOT EXISTS ref_base            VARCHAR(200),
  -- Sidecar MP3 produced during re-encode. NULL if audio extraction failed.
  ADD COLUMN IF NOT EXISTS audio_storage_key   TEXT,
  -- 64-bit dHash of source midpoint (or average of clip pHashes). Lets us
  -- detect "same movie re-encoded" without per-clip comparison.
  ADD COLUMN IF NOT EXISTS phash               BIGINT;

-- Reject re-ingest of the same movie/episode/youtube into one library.
CREATE UNIQUE INDEX IF NOT EXISTS source_videos_library_ref_base_idx
  ON source_videos(library_id, ref_base) WHERE ref_base IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_videos_source_kind_idx
  ON source_videos(source_kind);

CREATE INDEX IF NOT EXISTS source_videos_youtube_id_idx
  ON source_videos(youtube_id) WHERE youtube_id IS NOT NULL;

-- ── 5. clips: ordinal + external_ref + dedup + aesthetic vectors ─────────
ALTER TABLE clips
  -- 0-based ordinal within source_video_id, ascending by start_ms.
  ADD COLUMN IF NOT EXISTS clip_index          INTEGER NOT NULL DEFAULT 0,
  -- ref_base || '/' || lpad(clip_index, 4, '0'). Human-readable, prompt-safe.
  ADD COLUMN IF NOT EXISTS external_ref        VARCHAR(240),
  -- Set by clip-embed when cosine distance < 0.01 to an older sibling.
  -- ON DELETE SET NULL so dropping the canonical clip doesn't cascade.
  ADD COLUMN IF NOT EXISTS duplicate_of_id     UUID REFERENCES clips(id) ON DELETE SET NULL,
  -- 64-bit dHash of midpoint keyframe. XOR + popcount in SQL = Hamming distance.
  ADD COLUMN IF NOT EXISTS phash               BIGINT,
  -- 0.0 (static) to 1.0 (chaotic). Computed at scene-detect time from the
  -- 27x48 frame buffer the sidecar already produces. Hard-filter target.
  ADD COLUMN IF NOT EXISTS motion_score        REAL,
  -- Top-3 dominant colors from midpoint frame, e.g. ['#1a2b3c','#cdefab',...].
  ADD COLUMN IF NOT EXISTS palette_dominant_hex TEXT[];

CREATE UNIQUE INDEX IF NOT EXISTS clips_library_external_ref_idx
  ON clips(library_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS clips_phash_idx
  ON clips(phash) WHERE phash IS NOT NULL;

CREATE INDEX IF NOT EXISTS clips_duplicate_of_idx
  ON clips(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clips_source_video_clip_index_idx
  ON clips(source_video_id, clip_index);

-- ── 6. Visual embedding reservation (separate PR wires the sidecar) ──────
-- halfvec(512) matches CLIP-L. Wrapped in DO so a missing pgvector ext
-- yields a clear error rather than aborting the whole migration.
DO $$ BEGIN
  ALTER TABLE clips ADD COLUMN IF NOT EXISTS embedding_visual halfvec(512);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pgvector halfvec type not available — embedding_visual column skipped';
END $$;
