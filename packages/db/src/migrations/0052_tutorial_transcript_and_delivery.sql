-- 0052: tutorial transcript + Drive delivery columns (plan §2.4 / D6)
--
-- The translation system (built on Konrad's laptop) consumes the raw recording
-- + a transcript. The tutorial pipeline produced NEITHER a transcript column
-- nor timings. These columns let the Drive agent ship (b) flat transcript and
-- (c) a timed transcript, and track raw-recording delivery.
--   - transcript_path:   file path to a timed transcript artifact (SRT/JSON), if generated
--   - transcript_json:   inline timed transcript (word/segment JSON), if generated
--   - transcript_source: provenance — 'tts_script_exact' (script_text is the
--                        word-exact TTS input, no timings) or 'whisper' (timed)
--   - raw_delivered_to_drive: whether the raw recording was uploaded to Drive
-- Non-destructive. Idempotent.
--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD COLUMN IF NOT EXISTS "transcript_path" text;
--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD COLUMN IF NOT EXISTS "transcript_json" jsonb;
--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD COLUMN IF NOT EXISTS "transcript_source" text;
--> statement-breakpoint
ALTER TABLE "tutorial_jobs" ADD COLUMN IF NOT EXISTS "raw_delivered_to_drive" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "tutorial_jobs"
  SET "transcript_source" = 'tts_script_exact'
  WHERE "script_text" IS NOT NULL AND "transcript_source" IS NULL;
