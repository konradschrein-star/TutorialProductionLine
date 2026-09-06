CREATE TABLE IF NOT EXISTS thumbnail_library_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  category varchar(24) NOT NULL CHECK (category IN ('PERSONAS','LOGOS','SYMBOLS','BGS')),
  file_path text NOT NULL,
  file_name varchar(255) NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  include_in_rotation boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_thumbnail_library_assets_category_created
  ON thumbnail_library_assets(category, created_at DESC);
