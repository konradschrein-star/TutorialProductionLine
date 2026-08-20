-- Migration: content_templates — swap style_collections FK for format_style_libraries FK
-- and add supports_character_tracking boolean column.
--
-- Changes:
--   1. Add column default_style_library_id (FK → format_style_libraries, ON DELETE SET NULL)
--   2. Copy values from default_style_collection_id → default_style_library_id
--   3. Drop old FK constraint referencing style_collections
--   4. Drop column default_style_collection_id
--   5. Add column supports_character_tracking (boolean NOT NULL DEFAULT false)

ALTER TABLE "content_templates" ADD COLUMN "default_style_library_id" uuid REFERENCES "public"."format_style_libraries"("id") ON DELETE SET NULL;--> statement-breakpoint
UPDATE "public"."content_templates" SET "default_style_library_id" = "default_style_collection_id" WHERE "default_style_collection_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "content_templates" DROP CONSTRAINT IF EXISTS "content_templates_default_style_collection_id_style_collections_id_fk";--> statement-breakpoint
ALTER TABLE "content_templates" DROP COLUMN IF EXISTS "default_style_collection_id";--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "supports_character_tracking" boolean NOT NULL DEFAULT false;
