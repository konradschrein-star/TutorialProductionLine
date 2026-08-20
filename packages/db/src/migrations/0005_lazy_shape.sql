ALTER TABLE "caption_presets" ALTER COLUMN "is_default" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "video_stitch_jobs" ADD COLUMN "speed_adjust_mode" varchar(50) DEFAULT 'audio_to_video' NOT NULL;--> statement-breakpoint
ALTER TABLE "music_presets" ADD COLUMN "mood" text[];--> statement-breakpoint
ALTER TABLE "music_presets" ADD COLUMN "bpm" integer;--> statement-breakpoint
ALTER TABLE "music_presets" ADD COLUMN "genre" varchar(100);--> statement-breakpoint
ALTER TABLE "music_presets" ADD COLUMN "duration_seconds" real;--> statement-breakpoint
CREATE INDEX "idx_caption_presets_name" ON "caption_presets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_caption_presets_default" ON "caption_presets" USING btree ("is_default");
