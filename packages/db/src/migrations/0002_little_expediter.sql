CREATE TABLE "caption_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_default" boolean DEFAULT false,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_stitch_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"input_videos" jsonb NOT NULL,
	"output_filename" varchar(255) NOT NULL,
	"target_width" integer DEFAULT 1920 NOT NULL,
	"target_height" integer DEFAULT 1080 NOT NULL,
	"target_fps" integer DEFAULT 30 NOT NULL,
	"transition_type" varchar(50) DEFAULT 'hard_cut',
	"transition_duration_seconds" integer DEFAULT 0,
	"voiceover_enabled" boolean DEFAULT false,
	"voiceover_file_path" text,
	"voiceover_original_duration_seconds" integer,
	"voiceover_target_duration_seconds" integer,
	"voiceover_speed_factor" integer,
	"music_enabled" boolean DEFAULT false,
	"music_file_path" text,
	"music_volume" integer DEFAULT 50,
	"captions_enabled" boolean DEFAULT false,
	"caption_preset_id" uuid,
	"caption_config" jsonb,
	"progress" integer DEFAULT 0,
	"render_started_at" timestamp with time zone,
	"render_completed_at" timestamp with time zone,
	"total_render_time_seconds" integer,
	"output_video_path" text,
	"output_duration_seconds" integer,
	"output_size_bytes" bigint,
	"whisper_output" jsonb,
	"error_message" text,
	"error_detail" jsonb,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_stitch_jobs" ADD CONSTRAINT "video_stitch_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_video_stitch_jobs_status" ON "video_stitch_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_video_stitch_jobs_created_by" ON "video_stitch_jobs" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_video_stitch_jobs_created_at" ON "video_stitch_jobs" USING btree ("created_at");--> statement-breakpoint

-- Seed data: 8 default caption presets for video stitcher
INSERT INTO "caption_presets" ("name", "is_default", "config") VALUES
('Default', true, '{"position":"bottom-center","vertical_offset_percent":10,"font_family":"Arial","font_size":72,"primary_color":"#FFFFFF","highlight_color":"#AAFF00","all_caps":false,"show_punctuation":true,"window_size":6,"outline_width":4,"shadow_offset":2,"background_opacity":0}'),
('Large Bold', false, '{"position":"bottom-center","vertical_offset_percent":10,"font_family":"Impact","font_size":96,"primary_color":"#FFFFFF","highlight_color":"#FFD700","all_caps":true,"show_punctuation":true,"window_size":6,"outline_width":6,"shadow_offset":3,"background_opacity":0}'),
('Minimal', false, '{"position":"top-center","vertical_offset_percent":5,"font_family":"Roboto","font_size":48,"primary_color":"#FFFFFF","highlight_color":"#AAFF00","all_caps":false,"show_punctuation":false,"window_size":6,"outline_width":0,"shadow_offset":0,"background_opacity":0}'),
('Yellow Highlight', false, '{"position":"bottom-center","vertical_offset_percent":10,"font_family":"Arial","font_size":72,"primary_color":"#FFFF00","highlight_color":"#AAFF00","all_caps":false,"show_punctuation":true,"window_size":6,"outline_width":4,"shadow_offset":2,"background_opacity":0}'),
('Tutorial Style', false, '{"position":"bottom-center","vertical_offset_percent":15,"font_family":"Open Sans","font_size":64,"primary_color":"#FFFFFF","highlight_color":"#00D9FF","all_caps":false,"show_punctuation":true,"window_size":8,"outline_width":3,"shadow_offset":2,"background_opacity":20}'),
('Gaming Style', false, '{"position":"top-left","vertical_offset_percent":5,"font_family":"Bebas Neue","font_size":56,"primary_color":"#00FF00","highlight_color":"#FFFF00","all_caps":true,"show_punctuation":false,"window_size":5,"outline_width":3,"shadow_offset":1,"background_opacity":40}'),
('Accessibility', false, '{"position":"bottom-center","vertical_offset_percent":10,"font_family":"Arial","font_size":88,"primary_color":"#000000","highlight_color":"#FFFF00","all_caps":false,"show_punctuation":true,"window_size":6,"outline_width":0,"shadow_offset":0,"background_opacity":80}'),
('Karaoke', false, '{"position":"bottom-center","vertical_offset_percent":10,"font_family":"Arial","font_size":72,"primary_color":"#CCCCCC","highlight_color":"#FF00FF","all_caps":false,"show_punctuation":true,"window_size":10,"outline_width":4,"shadow_offset":2,"background_opacity":0}');