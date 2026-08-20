-- 0027: asset variant lineage columns
--
-- The asset library's "variants" feature (compressed/mobile/translated/cropped
-- derivatives of a parent asset, linked via assets.parent_asset_id) stores the
-- derivative's kind and per-variant details on the asset row itself.
--
-- These columns were already applied by hand on production (see
-- packages/db/apply-variant-migration.ts) but the migration file that shipped
-- them was never committed, so schema.ts and fresh/dev databases drifted out
-- of sync with prod. This migration is idempotent so it is safe to run
-- against a database that already has these columns (prod) as well as one
-- that doesn't (dev/CI).
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS variant_type varchar(20),
  ADD COLUMN IF NOT EXISTS variant_metadata jsonb;
