import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  bundestagCameraAngleEnum,
  bundestagSyncMethodEnum,
  bundestagTranscriptionQualityGradeEnum,
} from "./enums.js";
import { contentJobs } from "./content-jobs.js";

/**
 * Bundestag Clips Table
 *
 * Stores individual video clip metadata and transcription data for
 * multi-camera Bundestag speech footage.
 *
 * Each clip represents one camera angle's view of the same speech.
 * Clips are synchronized using audio cross-correlation and analyzed
 * with Whisper for word-level transcription.
 *
 * Production-ready fields include:
 * - Multi-camera synchronization offsets
 * - Transcription quality assessment
 * - FFmpeg concat compatibility metadata
 * - Clip normalization status
 */
export const bundestagClips = pgTable(
  "bundestag_clips",
  {
    // === Identity ===
    id: uuid("id").primaryKey().defaultRandom(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => contentJobs.id, { onDelete: "cascade" }),

    // === Clip Identity ===
    clip_id: varchar("clip_id", { length: 255 }).notNull(),
    source_url: text("source_url"),
    local_path: text("local_path").notNull(),

    // === Single-Stream Architecture Fields ===
    // For single-stream processing, each clip represents a segment of the full video
    start_offset: numeric("start_offset", { precision: 10, scale: 3 }), // Start time in seconds from video start
    end_offset: numeric("end_offset", { precision: 10, scale: 3 }), // End time in seconds from video start
    party: varchar("party", { length: 50 }), // SPD, CDU, AFD, GRUENE, FDP, LINKE, UNKNOWN
    speaker_name: varchar("speaker_name", { length: 255 }), // Optional, can enhance later with face recognition

    // === Video Metadata ===
    camera_angle: bundestagCameraAngleEnum("camera_angle"),
    duration_seconds: numeric("duration_seconds", { precision: 10, scale: 3 }),
    resolution: varchar("resolution", { length: 20 }),
    width: integer("width"),
    height: integer("height"),
    fps: numeric("fps", { precision: 6, scale: 3 }), // Support 23.976, 29.97
    codec: varchar("codec", { length: 50 }),
    pixel_format: varchar("pixel_format", { length: 20 }), // yuv420p, yuv422p, etc.
    bitrate_kbps: integer("bitrate_kbps"),
    file_size_bytes: bigint("file_size_bytes", { mode: "number" }),
    has_audio: boolean("has_audio").default(true),
    sample_rate: integer("sample_rate"), // 48000, 44100, etc.

    // === Multi-Camera Synchronization ===
    sync_offset_ms: integer("sync_offset_ms").default(0),
    sync_confidence: numeric("sync_confidence", { precision: 4, scale: 3 }),
    sync_method: bundestagSyncMethodEnum("sync_method"),
    is_reference_clip: boolean("is_reference_clip").default(false),

    // === Transcription (Faster Whisper Output) ===
    transcript_text: text("transcript_text"),
    transcript_words: jsonb("transcript_words").$type<
      Array<{
        word: string;
        start: number;
        end: number;
        confidence?: number;
      }>
    >(),
    transcript_language: varchar("transcript_language", { length: 10 }),
    transcription_completed_at: timestamp("transcription_completed_at", {
      withTimezone: true,
    }),

    // === Transcription Quality Assessment ===
    transcription_quality_grade: bundestagTranscriptionQualityGradeEnum(
      "transcription_quality_grade",
    ),
    transcription_confidence: numeric("transcription_confidence", {
      precision: 4,
      scale: 3,
    }),
    transcription_flags: jsonb("transcription_flags").$type<string[]>(),

    // === Clip Normalization Status ===
    normalization_required: boolean("normalization_required").default(false),
    normalization_completed: boolean("normalization_completed").default(false),
    normalized_path: text("normalized_path"),

    // === Optional: Face Recognition (Phase 2) ===
    detected_speaker_name: varchar("detected_speaker_name", { length: 255 }),
    speaker_confidence: numeric("speaker_confidence", {
      precision: 5,
      scale: 2,
    }),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Indexes for common queries
    jobIdIdx: index("bundestag_clips_job_id_idx").on(table.job_id),
    clipIdIdx: index("bundestag_clips_clip_id_idx").on(table.clip_id),
    cameraAngleIdx: index("bundestag_clips_camera_angle_idx").on(
      table.camera_angle,
    ),
    referenceClipIdx: index("bundestag_clips_reference_idx").on(
      table.is_reference_clip,
    ),
    qualityGradeIdx: index("bundestag_clips_quality_grade_idx").on(
      table.transcription_quality_grade,
    ),

    // Unique constraint: one clip_id per job
    jobClipUniqueIdx: uniqueIndex("bundestag_clips_job_id_clip_id_unique").on(
      table.job_id,
      table.clip_id,
    ),
  }),
);

/**
 * Bundestag Clips Relations
 *
 * Defines the relationship between clips and their parent job.
 */
export const bundestagClipsRelations = relations(bundestagClips, ({ one }) => ({
  job: one(contentJobs, {
    fields: [bundestagClips.job_id],
    references: [contentJobs.id],
  }),
}));
