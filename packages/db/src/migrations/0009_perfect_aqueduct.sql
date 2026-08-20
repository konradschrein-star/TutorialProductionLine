-- Tutorial Production Engine — Phase 1 schema.
-- NOTE: This migration was trimmed to TUTORIAL-ONLY statements. drizzle-kit also
-- detected pre-existing drift on `main` (clip-library / drama / space-video / bundestag
-- tables + job_status/content_format enum additions) whose migration files exist on disk
-- but were never recorded in meta/_journal.json. Those tables already exist in the live DB,
-- so creating them here would fail; they are intentionally excluded. The accompanying
-- 0009 snapshot still reflects the full schema (matching the live DB) so future
-- `db:generate` stays consistent. Reconcile the un-journaled migrations separately.
CREATE TYPE "public"."secret_capability" AS ENUM('LLM', 'TTS');--> statement-breakpoint
CREATE TYPE "public"."tutorial_job_status" AS ENUM('QUEUED', 'GENERATING_SCRIPT', 'GENERATING_AUDIO', 'READY_TO_RECORD', 'AWAITING_UPLOAD', 'SPLICING', 'COMPLETED', 'FAILED_SCRIPT', 'FAILED_AUDIO', 'FAILED_SPLICE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tutorial_mode" AS ENUM('THREE_MIN', 'SIX_MIN', 'SIX_MIN_STITCH');--> statement-breakpoint
CREATE TYPE "public"."tutorial_prompt_category" AS ENUM('THREE_MIN', 'SIX_MIN', 'SIX_MIN_STITCH');--> statement-breakpoint
CREATE TABLE "tutorial_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"batch_id" uuid,
	"title" text NOT NULL,
	"mode" "tutorial_mode" NOT NULL,
	"status" "tutorial_job_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"steps_input" text DEFAULT '' NOT NULL,
	"prompt_preset_id" uuid,
	"custom_prompt" text,
	"script_provider" text NOT NULL,
	"script_model" text,
	"tts_provider" text NOT NULL,
	"tts_voice" text NOT NULL,
	"script_text" text,
	"audio_path" text,
	"audio_duration_s" numeric(10, 3),
	"playback_speed" numeric(4, 2),
	"recording_path" text,
	"recording_duration_s" numeric(10, 3),
	"final_path" text,
	"target_minutes" integer,
	"ref_video_seconds" integer,
	"delivered_to_drive" boolean DEFAULT false NOT NULL,
	"error_stage" text,
	"error_message" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"script_done_at" timestamp with time zone,
	"audio_done_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutorial_prompt_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "tutorial_prompt_category" NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text DEFAULT 'tutorial-production' NOT NULL,
	"capability" "secret_capability" NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"last4" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encrypted_secrets_slot_uq" UNIQUE("namespace","capability","provider")
);
--> statement-breakpoint
CREATE TABLE "tutorial_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_script_provider" text DEFAULT 'gemini_pool' NOT NULL,
	"default_script_model" text,
	"default_tts_provider" text DEFAULT 'ai33_elevenlabs' NOT NULL,
	"default_tts_voice" text DEFAULT '' NOT NULL,
	"default_playback_speed" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"record_hotkey" text DEFAULT 'Space' NOT NULL,
	"retention_hours" integer DEFAULT 48 NOT NULL,
	"drive_autoupload_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD CONSTRAINT "tutorial_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_prompt_presets" ADD CONSTRAINT "tutorial_prompt_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_secrets" ADD CONSTRAINT "encrypted_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_secrets" ADD CONSTRAINT "encrypted_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutorial_jobs_created_by_idx" ON "tutorial_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "tutorial_jobs_status_idx" ON "tutorial_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tutorial_jobs_batch_id_idx" ON "tutorial_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "tutorial_prompt_presets_category_idx" ON "tutorial_prompt_presets" USING btree ("category");
