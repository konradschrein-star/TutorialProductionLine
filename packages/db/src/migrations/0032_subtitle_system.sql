CREATE TABLE IF NOT EXISTS "subtitle_fonts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "file_path" varchar(500) NOT NULL,
  "format" varchar(10) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subtitle_presets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "engine" varchar(10) NOT NULL,
  "config" jsonb NOT NULL,
  "is_built_in" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subtitle_preset_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "preset_id" uuid NOT NULL,
  "format" varchar(50),
  "channel_id" uuid,
  CONSTRAINT "uq_subtitle_preset_assignments_format_channel" UNIQUE("format","channel_id")
);

DO $$ BEGIN
 ALTER TABLE "subtitle_preset_assignments" ADD CONSTRAINT "subtitle_preset_assignments_preset_id_subtitle_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."subtitle_presets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_subtitle_fonts_name" ON "subtitle_fonts" USING btree ("name");
CREATE INDEX IF NOT EXISTS "idx_subtitle_presets_engine" ON "subtitle_presets" USING btree ("engine");
CREATE INDEX IF NOT EXISTS "idx_subtitle_presets_active" ON "subtitle_presets" USING btree ("is_active");
CREATE INDEX IF NOT EXISTS "idx_subtitle_preset_assignments_preset" ON "subtitle_preset_assignments" USING btree ("preset_id");
