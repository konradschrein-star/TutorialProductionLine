CREATE TABLE "remotion_caption_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_remotion_caption_presets_name" ON "remotion_caption_presets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_remotion_caption_presets_default" ON "remotion_caption_presets" USING btree ("is_default");