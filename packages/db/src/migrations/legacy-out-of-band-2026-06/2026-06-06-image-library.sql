-- Image library: parallel ingest path for stock photos / uploads / scraped
-- images. Mirrors the video clip pipeline (source_videos → clips → embeddings)
-- but without temporal semantics. Shares clip_libraries (tag vocabulary,
-- character_registry, storage backend) so a single library can hold both
-- video clips and stills.
--
-- All ADD operations are idempotent. Re-runnable.

-- ── 1. source_images ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES clip_libraries(id) ON DELETE RESTRICT,
  ingest_status clip_ingest_status NOT NULL DEFAULT 'pending',
  -- Identity (mirrors source_videos, reuses the source_kind enum)
  source_kind source_kind NOT NULL DEFAULT 'other',
  source_url TEXT,
  source_file_path TEXT,
  work_slug VARCHAR(120),
  work_title VARCHAR(300),
  external_provider VARCHAR(40),       -- 'pexels','unsplash','custom-scraper'
  external_id VARCHAR(200),
  ref_base VARCHAR(200),               -- 'pexels/12345-fire-burning'
  -- Storage
  content_hash VARCHAR(64),            -- SHA-256 of downloaded bytes
  storage_key TEXT,                    -- 'images/sources/{ref_base}/source.jpg'
  cdn_url TEXT,
  width SMALLINT,
  height SMALLINT,
  format VARCHAR(20),                  -- 'jpg' | 'png' | 'webp'
  bytes INTEGER,
  -- Aesthetic signals computed at ingest (no scene detection needed)
  phash BIGINT,
  palette_dominant_hex TEXT[],
  -- Attribution for stock providers — kept as JSONB to absorb provider quirks
  license JSONB,
  attribution JSONB,
  -- State + audit
  error_message TEXT,
  ingest_started_at TIMESTAMPTZ,
  ingest_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_images_library_id_idx
  ON source_images(library_id);
CREATE INDEX IF NOT EXISTS source_images_ingest_status_idx
  ON source_images(ingest_status);
CREATE UNIQUE INDEX IF NOT EXISTS source_images_content_hash_idx
  ON source_images(content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS source_images_library_ref_base_idx
  ON source_images(library_id, ref_base) WHERE ref_base IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_images_source_kind_idx
  ON source_images(source_kind);
CREATE INDEX IF NOT EXISTS source_images_phash_idx
  ON source_images(phash) WHERE phash IS NOT NULL;

-- ── 2. images ───────────────────────────────────────────────────────────
-- 1:1 with source_images (each source row IS the image; no scene cuts).
-- Mirrors clips' label + embedding columns but skips temporal fields.
CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES clip_libraries(id) ON DELETE RESTRICT,
  source_image_id UUID NOT NULL REFERENCES source_images(id) ON DELETE CASCADE,
  external_ref VARCHAR(240),           -- 'pexels/12345-fire-burning/0000'

  -- Labeling state (idempotent retry; vlm → face → done — no whisper/audio)
  labeling_step clip_labeling_step,    -- reused enum; 'whisper'/'audio' unused
  review_status clip_review_status NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,

  -- AI labels (mirror clips)
  ai_description TEXT,
  ai_confidence REAL,
  shot_scale clip_shot_scale,
  clip_type clip_type DEFAULT 'unknown',
  dominant_mood VARCHAR(60),
  lighting_style VARCHAR(30),
  color_temperature VARCHAR(30),
  face_count SMALLINT,
  has_text_overlay BOOLEAN,
  source_episode VARCHAR(120),
  scene_context TEXT,

  -- Shared tag vocabulary with clips
  tags_characters TEXT[] NOT NULL DEFAULT '{}',
  tags_mood TEXT[] NOT NULL DEFAULT '{}',
  tags_location TEXT[] NOT NULL DEFAULT '{}',
  tags_action TEXT[] NOT NULL DEFAULT '{}',
  tags_custom TEXT[] NOT NULL DEFAULT '{}',
  characters_present TEXT[] NOT NULL DEFAULT '{}',  -- ArcFace registry hits
  keywords TEXT[] NOT NULL DEFAULT '{}',

  -- Human review
  quality_score SMALLINT,
  manual_notes TEXT,
  is_usable BOOLEAN,

  -- Dedup
  duplicate_of_id UUID REFERENCES images(id) ON DELETE SET NULL,

  -- Usage tracking
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS images_library_id_idx ON images(library_id);
CREATE INDEX IF NOT EXISTS images_source_image_id_idx ON images(source_image_id);
CREATE INDEX IF NOT EXISTS images_review_status_idx ON images(review_status);
CREATE INDEX IF NOT EXISTS images_labeling_step_idx ON images(labeling_step);
CREATE UNIQUE INDEX IF NOT EXISTS images_library_external_ref_idx
  ON images(library_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS images_duplicate_of_idx
  ON images(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

-- GIN indexes on tag arrays — same pattern as clips
CREATE INDEX IF NOT EXISTS images_tags_characters_gin
  ON images USING gin (tags_characters);
CREATE INDEX IF NOT EXISTS images_tags_mood_gin ON images USING gin (tags_mood);
CREATE INDEX IF NOT EXISTS images_tags_location_gin
  ON images USING gin (tags_location);
CREATE INDEX IF NOT EXISTS images_tags_action_gin
  ON images USING gin (tags_action);
CREATE INDEX IF NOT EXISTS images_characters_present_gin
  ON images USING gin (characters_present);

-- ── 3. Embeddings (raw SQL — Drizzle has no halfvec type) ──────────────
-- Dense text embedding via BGE-M3 (same model + dimension as clips).
-- Sparse embedding stored as jsonb { indices: number[], values: number[] }.
-- Visual embedding reserved for the CLIP sidecar (separate PR).
DO $$ BEGIN
  ALTER TABLE images
    ADD COLUMN IF NOT EXISTS embedding halfvec(384),
    ADD COLUMN IF NOT EXISTS embedding_sparse JSONB,
    ADD COLUMN IF NOT EXISTS embedding_visual halfvec(512);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pgvector halfvec type not available — embedding columns skipped';
END $$;

-- HNSW index for dense cosine ANN search; only build it if halfvec exists.
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS images_embedding_hnsw
    ON images USING hnsw (embedding halfvec_cosine_ops);
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Text-search index covering ai_description (transcript doesn't exist for images).
CREATE INDEX IF NOT EXISTS images_ai_description_fts
  ON images USING gin (to_tsvector('english', COALESCE(ai_description, '')));
