import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  jsonb,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { channels } from "./channels.js";
import { tutorialJobStatusEnum, tutorialModeEnum } from "./tutorial-enums.js";

export const tutorialJobs = pgTable(
  "tutorial_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Channel assignment — drives which thumbnail styling/archetypes to use.
    // Nullable for back-compat with tutorial jobs created before this column.
    channel_id: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),
    batch_id: uuid("batch_id"),

    // External cross-reference to the Keyword Tool (Video ERP binding). Set only
    // when a tutorial job originates from a claimed keyword; null for jobs created
    // directly in Tutorial Studio. keyword_ref = the KT keyword id (as text);
    // kt_url = a deep link back to that keyword on the board.
    keyword_ref: text("keyword_ref"),
    kt_url: text("kt_url"),

    // SIX_MIN_STITCH chaining: parent has mode=SIX_MIN_STITCH, children have parent_job_id set
    parent_job_id: uuid("parent_job_id").references(
      (): AnyPgColumn => tutorialJobs.id,
      { onDelete: "cascade" },
    ),
    segment_index: integer("segment_index"),

    // Localization: a translated variant points at its source English job. Set on
    // de/fr/es/ja/ko children created by the translate pipeline; null for originals.
    source_job_id: uuid("source_job_id").references(
      (): AnyPgColumn => tutorialJobs.id,
      { onDelete: "cascade" },
    ),

    title: text("title").notNull(),
    mode: tutorialModeEnum("mode").notNull(),
    status: tutorialJobStatusEnum("status").notNull().default("QUEUED"),
    progress: integer("progress").notNull().default(0),

    steps_input: text("steps_input").notNull().default(""),
    prompt_preset_id: uuid("prompt_preset_id"),
    custom_prompt: text("custom_prompt"),
    // Optional extra context/instructions for LONG_FORM script generation
    extra_context: text("extra_context"),

    // Script source mode. FROM_SCRATCH = research-based write; TRANSCRIPT_REWRITE
    // = rewrite a reference video's transcript into our own unique script.
    // reference_url/reference_transcript carry the source when rewriting.
    source_mode: text("source_mode").notNull().default("FROM_SCRATCH"),
    reference_url: text("reference_url"),
    reference_transcript: text("reference_transcript"),
    // How reference_transcript was obtained: 'provided' (operator paste or a
    // Keyword Tool push), 'youtube_manual_captions', 'youtube_auto_captions'.
    // Auto captions are lossy, so downstream QA needs to know which it got.
    reference_transcript_source: text("reference_transcript_source"),
    reference_transcript_fetched_at: timestamp(
      "reference_transcript_fetched_at",
      { withTimezone: true },
    ),
    // Target spoken language (e.g. "English", "German"). Null/empty → English.
    language: text("language"),

    script_provider: text("script_provider").notNull(),
    script_model: text("script_model"),
    tts_provider: text("tts_provider").notNull(),
    // The provider that ACTUALLY produced audio_path. tts_provider above is
    // only what was REQUESTED — when the fallback chain moves past it, the
    // winner used to exist solely in a log line, so "was this video AI33 or
    // Fish?" was unanswerable after the fact. NULL = not recorded (every row
    // predating migration 0058); do not back-fill it from tts_provider, since
    // that is the value a fallback makes wrong.
    tts_provider_used: text("tts_provider_used"),
    tts_voice: text("tts_voice").notNull(),
    voice_settings: jsonb("voice_settings").$type<Record<string, unknown>>(),

    script_text: text("script_text"),
    // Section structure of script_text — {version, source, sections:[{kind,
    // title, char_start, char_end, word_start, word_end, word_count}]}.
    // script_text stays the exact TTS input (no markers); this carries the
    // shape alongside it so chapters/banners/per-section QA become possible.
    // See apps/worker-orchestrator/src/utils/tutorial/script-structure.ts.
    script_structure: jsonb("script_structure").$type<unknown>(),
    audio_path: text("audio_path"),
    audio_duration_s: numeric("audio_duration_s", { precision: 10, scale: 3 }),
    playback_speed: numeric("playback_speed", { precision: 4, scale: 2 }),
    recording_path: text("recording_path"),
    recording_duration_s: numeric("recording_duration_s", {
      precision: 10,
      scale: 3,
    }),
    final_path: text("final_path"),

    target_minutes: integer("target_minutes"),
    ref_video_seconds: integer("ref_video_seconds"),

    // LONG_FORM additions
    part_length_minutes: integer("part_length_minutes").default(8),
    long_audio_path: text("long_audio_path"),
    stitch_job_id: uuid("stitch_job_id"),

    delivered_to_drive: boolean("delivered_to_drive").notNull().default(false),

    // Transcript + Drive delivery (migration 0052 / §2.4). Feeds the external
    // translation system (raw recording + transcript). transcript_source:
    // 'tts_script_exact' (script_text, no timings) or 'whisper' (timed).
    transcript_path: text("transcript_path"),
    transcript_json: jsonb("transcript_json").$type<unknown>(),
    transcript_source: text("transcript_source"),
    raw_delivered_to_drive: boolean("raw_delivered_to_drive")
      .notNull()
      .default(false),

    // Upload metadata (migration 0065). `content_jobs` has had `description`
    // and `generated_tags` all along; tutorials had neither, so a VA opening
    // Drive got a lowercase slug and nothing else. NULL means "not generated"
    // and is printed as such on the upload sheet — never filled with a guess.
    description: text("description"),
    tags: jsonb("tags").$type<string[]>(),
    // Localized two-line copy for the deterministic thumbnail compositor.
    // NULL means the metadata model did not provide usable copy; callers must
    // surface that gap rather than substituting a generic English slogan.
    thumbnail_text_top: text("thumbnail_text_top"),
    thumbnail_text_bottom: text("thumbnail_text_bottom"),

    // Manual YouTube upload tracking (migration 0069)
    is_uploaded: boolean("is_uploaded").notNull().default(false),
    uploaded_at: timestamp("uploaded_at", { withTimezone: true }),
    uploaded_by: text("uploaded_by"),
    youtube_upload_url: text("youtube_upload_url"),

    // External uploader lifecycle. `is_uploaded` remains as a compatibility
    // projection, while these fields preserve scheduled vs actually public.
    uploader_status: text("uploader_status"),
    youtube_visibility: text("youtube_visibility"),
    scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
    youtube_published_at: timestamp("youtube_published_at", {
      withTimezone: true,
    }),
    uploader_job_id: text("uploader_job_id"),
    uploader_event_id: text("uploader_event_id"),
    uploader_last_callback_at: timestamp("uploader_last_callback_at", {
      withTimezone: true,
    }),
    upload_verified_at: timestamp("upload_verified_at", { withTimezone: true }),

    // Final approval is required for dispatch. NULL = awaiting review;
    // rework_requested returns to recording without deleting existing assets.
    // Legacy disapproved rows remain historical records, never deletion orders.
    va_review_status: text("va_review_status"),
    va_reviewed_at: timestamp("va_reviewed_at", { withTimezone: true }),
    va_reviewed_by: uuid("va_reviewed_by"),
    publication_approval: jsonb("publication_approval").$type<Record<string, unknown>>(),
    localization_source_revision: varchar("localization_source_revision", { length: 64 }),

    // Output QA verdict (migration 0064). NULL = never checked, which is the
    // correct state for every tutorial that completed before the gate existed —
    // they are not retroactively failed. 'failed' blocks Drive delivery until a
    // human looks; the video is never auto-deleted.
    output_qa_status: text("output_qa_status"),
    output_qa_detail: jsonb("output_qa_detail").$type<unknown>(),
    output_qa_checked_at: timestamp("output_qa_checked_at", {
      withTimezone: true,
    }),

    error_stage: text("error_stage"),
    error_message: text("error_message"),
    error_detail: text("error_detail"),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    script_done_at: timestamp("script_done_at", { withTimezone: true }),
    audio_done_at: timestamp("audio_done_at", { withTimezone: true }),
    recorded_at: timestamp("recorded_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    createdByIdx: index("tutorial_jobs_created_by_idx").on(t.created_by),
    channelIdx: index("tutorial_jobs_channel_id_idx").on(t.channel_id),
    statusIdx: index("tutorial_jobs_status_idx").on(t.status),
    batchIdx: index("tutorial_jobs_batch_id_idx").on(t.batch_id),
    parentJobIdx: index("tutorial_jobs_parent_job_id_idx").on(t.parent_job_id),
    keywordRefIdx: index("tutorial_jobs_keyword_ref_idx").on(t.keyword_ref),
    uploaderStatusIdx: index("tutorial_jobs_uploader_status_idx").on(
      t.uploader_status,
    ),
  }),
);
