CREATE TYPE "public"."asset_type" AS ENUM('style_guide', 'character', 'character_state', 'background', 'layout_reference', 'narrator_pose', 'video/raw-va-footage', 'video/raw-narrator-footage', 'audio/tts', 'image/thumbnail', 'image/broll', 'video/final-render');--> statement-breakpoint
CREATE TYPE "public"."bundestag_camera_angle" AS ENUM('wide', 'closeup', 'medium', 'reaction', 'speaker', 'audience', 'overview', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."bundestag_job_status" AS ENUM('CREATED', 'PENDING_UPLOAD', 'ANALYZING_CLIPS', 'CLIPS_ANALYZED', 'GENERATING_PLAYBOOK', 'PLAYBOOK_GENERATED', 'RENDERING', 'RENDERED', 'AWAITING_QA', 'QA_APPROVED', 'QA_REJECTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'FAILED_CLIP_ANALYSIS', 'FAILED_PLAYBOOK_GENERATION', 'FAILED_RENDERING', 'FAILED_QA');--> statement-breakpoint
CREATE TYPE "public"."bundestag_sync_method" AS ENUM('audio_correlation', 'manual', 'assumed_zero');--> statement-breakpoint
CREATE TYPE "public"."bundestag_transcription_quality_grade" AS ENUM('excellent', 'good', 'acceptable', 'poor', 'failed');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('EXPLAINER', 'NEWS_BROADCAST', 'DOCUMENTARY', 'POLITICAL_COMMENTARY', 'TECH_COMPARISON', 'DAY_IN_THE_LIFE', 'HISTORICAL_WHAT_IF', 'VIDEO_ESSAY', 'CASUALLY_EXPLAINED', 'STICKMAN_ANIMATION', 'SELF_NARRATED_STORY', 'BUNDESTAG');--> statement-breakpoint
CREATE TYPE "public"."image_generation_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('IDEA_GENERATION', 'SCRIPTING', 'AWAITING_RESEARCH', 'RESEARCH_UPLOADED', 'TRANSLATING', 'ASSET_COLLECTION', 'QMS_VALIDATING', 'ROUTING_RENDER', 'RENDERING_FFMPEG', 'RENDERING_REMOTION', 'AWAITING_PRODUCTION_VA', 'AWAITING_IMAGE_QC', 'AWAITING_QC', 'AWAITING_UPLOADER', 'UPLOADING', 'PUBLISHED', 'CANCELLED', 'DELETED', 'FAILED_QMS', 'FAILED_RENDER', 'FAILED_UPLOAD', 'FAILED_GENERAL', 'FAILED_IRRECOVERABLE', 'PAUSED', 'MARKED_FOR_DELETION');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('ADMIN', 'MANAGER', 'PRODUCTION_VA', 'UPLOADER_VA', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."production_version" AS ENUM('V1', 'V2', 'V3');--> statement-breakpoint
CREATE TYPE "public"."render_engine" AS ENUM('FFMPEG', 'REMOTION');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_channel_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_youtube_channel_id_unique" UNIQUE("youtube_channel_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"role" "operator_role" NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_job_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"preset_name" varchar(100) NOT NULL,
	"settings" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"format" "content_format" NOT NULL,
	"pipeline_stages" jsonb NOT NULL,
	"prompts" jsonb NOT NULL,
	"render_config" jsonb NOT NULL,
	"required_assets" jsonb NOT NULL,
	"metadata" jsonb,
	"default_style_collection_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"archetype_id" uuid,
	"status" "job_status" NOT NULL,
	"paused_from_status" "job_status",
	"status_updated_at" timestamp with time zone NOT NULL,
	"state_machine_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_production_va_id" uuid,
	"assigned_uploader_va_id" uuid,
	"production_va_time_spent_seconds" integer,
	"uploader_va_time_spent_seconds" integer,
	"production_version" "production_version" DEFAULT 'V2' NOT NULL,
	"format" "content_format" NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"initial_topic" text,
	"title" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"script" text,
	"generated_tags" text[],
	"render_engine" "render_engine",
	"aspect_ratio" varchar(10),
	"target_duration_seconds" integer,
	"duration_frames" integer,
	"render_started_at" timestamp with time zone,
	"render_completed_at" timestamp with time zone,
	"total_render_time_seconds" integer,
	"narration_source_path" text,
	"r2_asset_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assembly_manifest" jsonb,
	"size_bytes_total_assets" bigint,
	"final_video_size_bytes" bigint,
	"final_video_duration_seconds" integer,
	"youtube_video_id" varchar(50),
	"published_at" timestamp with time zone,
	"views" integer,
	"revenue_cents" integer,
	"skip_image_qc" boolean DEFAULT false NOT NULL,
	"skip_final_qc" boolean DEFAULT false NOT NULL,
	"qc_feedback" text,
	"qc_reviewed_at" timestamp with time zone,
	"metadata" jsonb,
	"generation_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"error_detail" jsonb,
	"error_metadata" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"worker_lease_id" uuid,
	"worker_lease_expires_at" timestamp with time zone,
	"idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"job_id" uuid,
	"payload" jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" varchar(20) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"general" jsonb,
	"pipeline" jsonb,
	"ai_services" jsonb,
	"storage" jsonb,
	"rendering" jsonb,
	"channels" jsonb,
	"notifications" jsonb,
	"security" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "singleton_check" CHECK ("system_settings"."id" = 'singleton')
);
--> statement-breakpoint
CREATE TABLE "style_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"asset_type" varchar(50) NOT NULL,
	"format" "content_format" NOT NULL,
	"channel_id" uuid,
	"file_path" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_collection_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"style_collection_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ref_type" varchar(50) NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"channel_id" uuid,
	"archetype_id" uuid,
	"format" varchar(50),
	"text_guidelines" text,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "format_style_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"format" varchar(50) NOT NULL,
	"text_guidelines" text,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "format_style_library_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ref_type" varchar(50) NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narrators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"voice_id" varchar(255) NOT NULL,
	"language" varchar(10) NOT NULL,
	"gender" varchar(20),
	"style" varchar(50),
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"settings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archetypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"style_prefix" text,
	"style_suffix" text,
	"image_style" varchar(30),
	"tags" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archetypes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "character_state_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_state_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"channel_id" uuid,
	"archetype_id" uuid,
	"reference_sheet_asset_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"origin" varchar(20) DEFAULT 'ai_generated' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"channel_id" uuid,
	"archetype_id" uuid,
	"format" varchar(50),
	"tags" text[] DEFAULT '{}' NOT NULL,
	"file_path" text,
	"r2_key" text,
	"file_name" varchar(255) NOT NULL,
	"file_format" varchar(20) NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" bigint,
	"thumbnail_path" text,
	"waveform_data" jsonb,
	"duration_seconds" integer,
	"background_removed" boolean DEFAULT false NOT NULL,
	"quality_rating" smallint,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"generation_recipe" jsonb,
	"parent_asset_id" uuid,
	"character_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"archetype_id" uuid,
	"channel_id" uuid,
	"background_asset_id" uuid NOT NULL,
	"prop_asset_ids" uuid[] DEFAULT '{}' NOT NULL,
	"spatial_hints" jsonb,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_frame_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"scene_index" integer NOT NULL,
	"frame_index" integer NOT NULL,
	"asset_id" uuid,
	"prompt_delta" text,
	"seed_asset_id" uuid,
	"transition_type" varchar(20) DEFAULT 'cut' NOT NULL,
	"hold_duration_ms" integer DEFAULT 500 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_timelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"timeline_data" jsonb NOT NULL,
	"saved_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_timelines_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "course_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"video_key" text NOT NULL,
	"duration_seconds" integer,
	"thumbnail_key" text,
	"transcript" text,
	"summary" text,
	"takeaways" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"thumbnail_key" text,
	"allowed_roles" text[] DEFAULT '{}' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"timestamp_seconds" integer,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_watch_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"last_position_seconds" integer DEFAULT 0 NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_collection_memberships" (
	"asset_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_collection_memberships_asset_id_collection_id_pk" PRIMARY KEY("asset_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "asset_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"color" varchar(7) DEFAULT '#6366F1',
	"icon" varchar(50) DEFAULT 'folder',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundestag_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"clip_id" varchar(255) NOT NULL,
	"source_url" text,
	"local_path" text NOT NULL,
	"camera_angle" "bundestag_camera_angle",
	"duration_seconds" numeric(10, 3),
	"resolution" varchar(20),
	"width" integer,
	"height" integer,
	"fps" numeric(6, 3),
	"codec" varchar(50),
	"pixel_format" varchar(20),
	"bitrate_kbps" integer,
	"file_size_bytes" bigint,
	"has_audio" boolean DEFAULT true,
	"sample_rate" integer,
	"sync_offset_ms" integer DEFAULT 0,
	"sync_confidence" numeric(4, 3),
	"sync_method" "bundestag_sync_method",
	"is_reference_clip" boolean DEFAULT false,
	"transcript_text" text,
	"transcript_words" jsonb,
	"transcript_language" varchar(10),
	"transcription_completed_at" timestamp with time zone,
	"transcription_quality_grade" "bundestag_transcription_quality_grade",
	"transcription_confidence" numeric(4, 3),
	"transcription_flags" jsonb,
	"normalization_required" boolean DEFAULT false,
	"normalization_completed" boolean DEFAULT false,
	"normalized_path" text,
	"detected_speaker_name" varchar(255),
	"speaker_confidence" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundestag_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" varchar(100),
	"editing_style" varchar(50),
	"editing_plan" jsonb NOT NULL,
	"quality_flags" jsonb,
	"total_segments" integer,
	"total_duration_seconds" numeric(10, 3),
	"total_cuts" integer,
	"generation_prompt" text,
	"generation_reasoning" text,
	"condensed_transcript" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_job_presets" ADD CONSTRAINT "user_job_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_job_presets" ADD CONSTRAINT "user_job_presets_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_default_style_collection_id_style_collections_id_fk" FOREIGN KEY ("default_style_collection_id") REFERENCES "public"."style_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD CONSTRAINT "content_jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD CONSTRAINT "content_jobs_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD CONSTRAINT "content_jobs_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD CONSTRAINT "content_jobs_assigned_production_va_id_users_id_fk" FOREIGN KEY ("assigned_production_va_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_jobs" ADD CONSTRAINT "content_jobs_assigned_uploader_va_id_users_id_fk" FOREIGN KEY ("assigned_uploader_va_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_events" ADD CONSTRAINT "system_events_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_assets" ADD CONSTRAINT "style_assets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_collection_assets" ADD CONSTRAINT "style_collection_assets_style_collection_id_style_collections_id_fk" FOREIGN KEY ("style_collection_id") REFERENCES "public"."style_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_collection_assets" ADD CONSTRAINT "style_collection_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_collections" ADD CONSTRAINT "style_collections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_collections" ADD CONSTRAINT "style_collections_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "format_style_library_assets" ADD CONSTRAINT "format_style_library_assets_library_id_format_style_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."format_style_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "format_style_library_assets" ADD CONSTRAINT "format_style_library_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrators" ADD CONSTRAINT "narrators_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_background_asset_id_assets_id_fk" FOREIGN KEY ("background_asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_frame_sequences" ADD CONSTRAINT "scene_frame_sequences_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_frame_sequences" ADD CONSTRAINT "scene_frame_sequences_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_frame_sequences" ADD CONSTRAINT "scene_frame_sequences_seed_asset_id_assets_id_fk" FOREIGN KEY ("seed_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_timelines" ADD CONSTRAINT "video_timelines_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_chapters" ADD CONSTRAINT "course_chapters_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_videos" ADD CONSTRAINT "course_videos_chapter_id_course_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."course_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_notes" ADD CONSTRAINT "video_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_notes" ADD CONSTRAINT "video_notes_video_id_course_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_progress" ADD CONSTRAINT "video_watch_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_progress" ADD CONSTRAINT "video_watch_progress_video_id_course_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."course_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_collection_memberships" ADD CONSTRAINT "asset_collection_memberships_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_collection_memberships" ADD CONSTRAINT "asset_collection_memberships_collection_id_asset_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."asset_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundestag_clips" ADD CONSTRAINT "bundestag_clips_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundestag_playbooks" ADD CONSTRAINT "bundestag_playbooks_job_id_content_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."content_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_jobs_status_idx" ON "content_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_jobs_channel_id_idx" ON "content_jobs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "content_jobs_template_id_idx" ON "content_jobs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "content_jobs_production_va_id_idx" ON "content_jobs" USING btree ("assigned_production_va_id");--> statement-breakpoint
CREATE INDEX "content_jobs_uploader_va_id_idx" ON "content_jobs" USING btree ("assigned_uploader_va_id");--> statement-breakpoint
CREATE INDEX "content_jobs_youtube_video_id_idx" ON "content_jobs" USING btree ("youtube_video_id");--> statement-breakpoint
CREATE INDEX "content_jobs_state_machine_history_idx" ON "content_jobs" USING btree ("state_machine_history");--> statement-breakpoint
CREATE INDEX "content_jobs_r2_asset_manifest_idx" ON "content_jobs" USING btree ("r2_asset_manifest");--> statement-breakpoint
CREATE INDEX "system_events_timestamp_idx" ON "system_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "system_events_job_id_idx" ON "system_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "system_events_event_type_idx" ON "system_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_style_collection_assets_collection" ON "style_collection_assets" USING btree ("style_collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_style_collection_assets_unique" ON "style_collection_assets" USING btree ("style_collection_id","asset_id");--> statement-breakpoint
CREATE INDEX "idx_style_collections_channel" ON "style_collections" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_style_collections_archetype" ON "style_collections" USING btree ("archetype_id");--> statement-breakpoint
CREATE INDEX "idx_style_collections_format" ON "style_collections" USING btree ("format");--> statement-breakpoint
CREATE INDEX "idx_format_style_libraries_format" ON "format_style_libraries" USING btree ("format");--> statement-breakpoint
CREATE INDEX "idx_format_style_libraries_active" ON "format_style_libraries" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_format_style_library_assets_library" ON "format_style_library_assets" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "idx_format_style_library_assets_asset" ON "format_style_library_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_format_style_library_assets_unique" ON "format_style_library_assets" USING btree ("library_id","asset_id");--> statement-breakpoint
CREATE INDEX "idx_narrators_channel" ON "narrators" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_narrators_default_per_channel" ON "narrators" USING btree ("channel_id","is_default") WHERE "narrators"."is_default" = true;--> statement-breakpoint
CREATE INDEX "video_timelines_job_id_idx" ON "video_timelines" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_watch_progress_user_video_uidx" ON "video_watch_progress" USING btree ("user_id","video_id");--> statement-breakpoint
CREATE INDEX "bundestag_clips_job_id_idx" ON "bundestag_clips" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "bundestag_clips_clip_id_idx" ON "bundestag_clips" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "bundestag_clips_camera_angle_idx" ON "bundestag_clips" USING btree ("camera_angle");--> statement-breakpoint
CREATE INDEX "bundestag_clips_reference_idx" ON "bundestag_clips" USING btree ("is_reference_clip");--> statement-breakpoint
CREATE INDEX "bundestag_clips_quality_grade_idx" ON "bundestag_clips" USING btree ("transcription_quality_grade");--> statement-breakpoint
CREATE UNIQUE INDEX "bundestag_clips_job_id_clip_id_unique" ON "bundestag_clips" USING btree ("job_id","clip_id");--> statement-breakpoint
CREATE INDEX "bundestag_playbooks_job_id_idx" ON "bundestag_playbooks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "bundestag_playbooks_active_idx" ON "bundestag_playbooks" USING btree ("job_id","is_active");--> statement-breakpoint
CREATE INDEX "bundestag_playbooks_version_idx" ON "bundestag_playbooks" USING btree ("job_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "bundestag_playbooks_job_version_unique" ON "bundestag_playbooks" USING btree ("job_id","version");--> statement-breakpoint

-- ============================================================================
-- Bundestag Job Status Fields (Production-Ready Migration)
-- ============================================================================
--
-- Add Bundestag-specific status tracking to content_jobs table.
-- This enables the state machine defined in BundestagJobStatus enum.
--
ALTER TABLE "content_jobs" ADD COLUMN "bundestag_status" "bundestag_job_status" DEFAULT 'CREATED';--> statement-breakpoint
ALTER TABLE "content_jobs" ADD COLUMN "status_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint

-- ============================================================================
-- Bundestag Status Change Trigger
-- ============================================================================
--
-- Automatically logs status transitions in status_history JSONB field.
-- Fires on every UPDATE to bundestag_status, recording:
--  - from: previous status
--  - to: new status
--  - timestamp: when the change occurred
--
-- This provides an immutable audit trail of all status changes for debugging
-- and operational visibility.
--
CREATE OR REPLACE FUNCTION "log_bundestag_status_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."bundestag_status" IS DISTINCT FROM NEW."bundestag_status" THEN
    NEW."status_updated_at" = NOW();
    NEW."status_history" = NEW."status_history" || jsonb_build_object(
      'from', OLD."bundestag_status",
      'to', NEW."bundestag_status",
      'timestamp', NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "bundestag_status_change_trigger"
BEFORE UPDATE ON "content_jobs"
FOR EACH ROW
EXECUTE FUNCTION "log_bundestag_status_change"();--> statement-breakpoint

-- ============================================================================
-- Bundestag Status Indexes
-- ============================================================================
--
-- Support efficient queries on job status for dashboard and worker lookups.
--
CREATE INDEX "content_jobs_bundestag_status_idx" ON "content_jobs" USING btree ("bundestag_status");--> statement-breakpoint
CREATE INDEX "content_jobs_status_history_idx" ON "content_jobs" USING gin ("status_history");