CREATE TABLE "music_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"file_path" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"genre" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_stitch_jobs" ALTER COLUMN "music_volume" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "video_stitch_jobs" ADD COLUMN "music_tracks" jsonb;--> statement-breakpoint

-- Seed sample music tracks (placeholder paths - replace with actual paths when deploying)
INSERT INTO "music_library" ("id", "name", "file_path", "duration_seconds", "genre")
VALUES
  (gen_random_uuid(), 'Upbeat Corporate', '/music/upbeat_corporate.mp3', 180, 'upbeat'),
  (gen_random_uuid(), 'Calm Background', '/music/calm_background.mp3', 240, 'calm'),
  (gen_random_uuid(), 'Dramatic Intro', '/music/dramatic_intro.mp3', 60, 'dramatic'),
  (gen_random_uuid(), 'Tech & Innovation', '/music/tech_innovation.mp3', 200, 'upbeat');