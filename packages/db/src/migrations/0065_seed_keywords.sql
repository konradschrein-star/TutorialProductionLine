-- Initial ("old") keywords — a hub-web-native fallback copy of the keyword
-- tool's guide-realm starter set (~2,150 keywords from the previous tutorial
-- tool). This table lives in hub-web's OWN Postgres so the VA can still pull a
-- keyword and run it through Create when the separate Keyword Tool app (its own
-- process + SQLite, embedded by iframe) is DOWN. Resilience is the whole point,
-- so nothing here may depend on the Keyword Tool at query time.
--
-- Rows are copied from kt_keywords WHERE source_channels LIKE '%guiderealm%'.
-- `id` mirrors the Keyword Tool id for traceability; a produced tutorial binds
-- to it as keyword_ref = 'seed:<id>'.
CREATE TABLE IF NOT EXISTS seed_keywords (
  id           integer PRIMARY KEY,
  title        text NOT NULL,
  software     text,
  content_type text,
  length_class text,
  duration_sec integer,
  video_id     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_keywords_length ON seed_keywords (length_class);
CREATE INDEX IF NOT EXISTS idx_seed_keywords_software ON seed_keywords (software);
