import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { remotionCaptionPresets } from "./remotion-caption-presets.js";

/**
 * Video Stitch Jobs Table
 *
 * Tracks video stitching jobs for VAs who need to combine multiple
 * tutorial recordings into single videos with optional voiceover,
 * music, and captions.
 *
 * Key features:
 * - Handles videos with different resolutions/FPS (normalized before stitching)
 * - Optional voiceover with automatic time-stretching
 * - Optional background music mixing
 * - Optional captions with customizable presets
 * - Remotion-based transitions between clips
 */
export const videoStitchJobs = pgTable(
  "video_stitch_jobs",
  {
    // === Identity ===
    id: uuid("id").primaryKey().defaultRandom(),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // === Status tracking ===
    status: varchar("status", { length: 50 }).notNull().default("PENDING"),
    // PENDING → PROCESSING → RENDERED → UPLOADED → COMPLETED
    // or → FAILED

    // === Input configuration ===
    input_videos: jsonb("input_videos")
      .$type<
        Array<{
          upload_id: string;
          filename: string;
          duration_seconds: number;
          width: number;
          height: number;
          fps: number;
          order_index: number;
          metadata: { recorded_at?: string };
          segment_audio_upload_id?: string;
        }>
      >()
      .notNull(),

    // === Output configuration ===
    output_filename: varchar("output_filename", { length: 255 }).notNull(),
    target_width: integer("target_width").notNull().default(1920),
    target_height: integer("target_height").notNull().default(1080),
    target_fps: integer("target_fps").notNull().default(30),

    // === Transition configuration ===
    transition_type: varchar("transition_type", { length: 50 }).default(
      "hard_cut",
    ),
    // hard_cut | fade | slide_left | slide_right | wipe
    transition_duration_seconds: integer("transition_duration_seconds").default(
      0,
    ),

    // === Voiceover configuration (NEW) ===
    voiceover_enabled: boolean("voiceover_enabled").default(false),
    voiceover_file_path: text("voiceover_file_path"),
    voiceover_original_duration_seconds: integer(
      "voiceover_original_duration_seconds",
    ),
    voiceover_target_duration_seconds: integer(
      "voiceover_target_duration_seconds",
    ),
    voiceover_speed_factor: integer("voiceover_speed_factor"), // e.g., 120 for 1.2x speed (stored as percentage)

    // === Speed adjustment mode ===
    speed_adjust_mode: varchar("speed_adjust_mode", { length: 50 })
      .default("audio_to_video")
      .notNull(),
    // audio_to_video: Time-stretch voiceover to match video duration (default)
    // video_to_audio: Speed-adjust video to match voiceover duration

    // === Alignment mode ===
    // "global"    : single voiceover stretched to total duration (default, unchanged)
    // "segmented" : each input video time-scaled to its own segment_audio (LONG_FORM)
    alignment_mode: varchar("alignment_mode", { length: 20 })
      .default("global")
      .notNull(),

    // === Music configuration ===
    music_enabled: boolean("music_enabled").default(false),
    // Legacy single-track music (optional, kept for backward compatibility)
    music_file_path: text("music_file_path"),
    music_volume: integer("music_volume"), // 0-100 (default 50)

    // NEW: Multi-track music chaining
    // Array of music tracks to chain together with custom start times and fades
    // Each track can reference a library track or use a custom uploaded file
    music_tracks: jsonb("music_tracks").$type<
      Array<{
        library_track_id?: string; // UUID reference to music_library.id
        custom_file_path?: string; // Or path to custom uploaded audio file
        start_time_seconds: number; // When this track starts in the video
        fade_in_seconds?: number; // Fade in duration (default 0)
        fade_out_seconds?: number; // Fade out duration (default 2)
        volume?: number; // 0-100 (default 50)
      }>
    >(),

    // === Caption configuration ===
    captions_enabled: boolean("captions_enabled").default(false),
    caption_preset_id: uuid("caption_preset_id"),
    caption_config: jsonb("caption_config").$type<{
      position?: string;
      vertical_offset_percent?: number;
      font_family?: string;
      font_size?: number;
      primary_color?: string;
      highlight_color?: string;
      all_caps?: boolean;
      show_punctuation?: boolean;
      window_size?: number;
      outline_width?: number;
      shadow_offset?: number;
    }>(),

    // === Remotion Caption configuration (alternative to FFmpeg ASS) ===
    remotion_enabled: boolean("remotion_enabled").default(false),
    remotion_preset_id: uuid("remotion_preset_id").references(
      () => remotionCaptionPresets.id,
      { onDelete: "set null" },
    ),

    // === Processing tracking ===
    progress: integer("progress").default(0), // 0-100
    render_started_at: timestamp("render_started_at", { withTimezone: true }),
    render_completed_at: timestamp("render_completed_at", {
      withTimezone: true,
    }),
    total_render_time_seconds: integer("total_render_time_seconds"),

    // === Output tracking ===
    output_video_path: text("output_video_path"),
    output_duration_seconds: integer("output_duration_seconds"),
    output_size_bytes: bigint("output_size_bytes", { mode: "number" }),

    // === Whisper transcription (for captions) ===
    whisper_output: jsonb("whisper_output").$type<{
      words: Array<{ word: string; start: number; end: number }>;
      segments?: Array<{
        text: string;
        start: number;
        end: number;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;
    }>(),

    // === Error handling ===
    error_message: text("error_message"),
    error_detail: jsonb("error_detail"),
    retry_count: integer("retry_count").default(0),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    statusIdx: index("idx_video_stitch_jobs_status").on(table.status),
    createdByIdx: index("idx_video_stitch_jobs_created_by").on(
      table.created_by_user_id,
    ),
    createdAtIdx: index("idx_video_stitch_jobs_created_at").on(
      table.created_at,
    ),
  }),
);
