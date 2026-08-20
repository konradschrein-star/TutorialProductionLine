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
import {
  jobStatusEnum,
  contentFormatEnum,
  renderEngineEnum,
  productionVersionEnum,
  imageGenerationModeEnum,
} from "./enums.js";
import { channels } from "./channels.js";
import { contentTemplates } from "./content-templates.js";
import { archetypes } from "./archetypes.js";
import { users } from "./users.js";

/**
 * Content Jobs Table
 *
 * Central entity tracking each content job through the pipeline.
 * The database owns durable system state - this table is the source of truth.
 *
 * Organized in 9 logical sections matching the Zod schema:
 * 1. Identity (id, channel_id, template_id)
 * 2. State tracking (status, paused_from_status, history)
 * 3. VA assignment (production_va_id, uploader_va_id)
 * 4. VA performance (time spent tracking)
 * 5. Content (format, title, description, script, tags)
 * 6. Render (engine, aspect ratio, duration, timing)
 * 7. Assets (narration source, R2 manifest, size tracking)
 * 8. Final video (metrics)
 * 9. YouTube (video_id, publishing, telemetry)
 * 10. Error handling (error_message, retry_count)
 * 11. Worker lease (idempotency, concurrency control)
 * 12. Timestamps (created_at, updated_at)
 *
 * Foreign key policies:
 * - channels/templates: RESTRICT (prevent accidental deletion)
 * - users: SET NULL (preserve history when VA deactivated)
 */
export const contentJobs = pgTable(
  "content_jobs",
  {
    // === Identity ===
    id: uuid("id").primaryKey().defaultRandom(),
    channel_id: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "restrict" }),
    template_id: uuid("template_id")
      .notNull()
      .references(() => contentTemplates.id, { onDelete: "restrict" }),
    archetype_id: uuid("archetype_id").references(() => archetypes.id, {
      onDelete: "set null",
    }),

    // === State tracking ===
    status: jobStatusEnum("status").notNull(),
    paused_from_status: jobStatusEnum("paused_from_status"),
    status_updated_at: timestamp("status_updated_at", {
      withTimezone: true,
    }).notNull(),
    /**
     * State machine transition history
     * Default: [] (empty array) - New job with no transitions yet
     * Appended to on every status transition for full audit trail
     * Never cleared - permanent record of job lifecycle
     */
    state_machine_history: jsonb("state_machine_history")
      .$type<
        Array<{
          from_status: string;
          to_status: string;
          timestamp: string;
          reason?: string;
        }>
      >()
      .notNull()
      .default([]),

    // === VA assignment ===
    assigned_production_va_id: uuid("assigned_production_va_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    assigned_uploader_va_id: uuid("assigned_uploader_va_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),

    // === VA performance tracking ===
    production_va_time_spent_seconds: integer(
      "production_va_time_spent_seconds",
    ),
    uploader_va_time_spent_seconds: integer("uploader_va_time_spent_seconds"),

    // === Content ===
    /**
     * Production pipeline version
     * Default: "V2" - Current stable FFmpeg-based pipeline
     * Override during job creation for specific render requirements:
     * - V1: Legacy (deprecated)
     * - V2: FFmpeg (GPU Ken Burns, current default)
     * - V3: Remotion (experimental, React-based)
     */
    production_version: productionVersionEnum("production_version")
      .notNull()
      .default("V2"),
    format: contentFormatEnum("format").notNull(),
    /**
     * Content language (ISO 639-1 code)
     * Default: "en" (English) - Most common language for content
     * Override during job creation for non-English content (e.g., "de", "es", "fr")
     * Affects: TTS voice selection, script generation, YouTube metadata
     */
    language: varchar("language", { length: 10 }).notNull().default("en"),
    // initial_topic: preserved verbatim from ingest so it's never lost when
    // Gemma-generated metadata overwrites title/description.
    initial_topic: text("initial_topic"),
    title: varchar("title", { length: 100 }).notNull(),
    description: text("description").notNull(),
    script: text("script"),
    generated_tags: text("generated_tags").array(),

    // === Render ===
    render_engine: renderEngineEnum("render_engine"),
    /**
     * Video aspect ratio
     * No default - must be specified during job creation
     * Common values: "16:9" (YouTube), "9:16" (mobile/TikTok), "1:1" (Instagram)
     * Note: If missing from payload, ingest processor defaults to "16:9"
     */
    aspect_ratio: varchar("aspect_ratio", { length: 10 }),
    target_duration_seconds: integer("target_duration_seconds"),
    duration_frames: integer("duration_frames"),
    render_started_at: timestamp("render_started_at", { withTimezone: true }),
    render_completed_at: timestamp("render_completed_at", {
      withTimezone: true,
    }),
    total_render_time_seconds: integer("total_render_time_seconds"),
    /**
     * Job progress percentage (0-100)
     * Default: 0 - Job just created, no work started
     * Updated by workers as job moves through pipeline
     * Used for UI progress bars and monitoring
     */
    progress: integer("progress").notNull().default(0), // 0-100 percent

    // === Assets ===
    // ⚠️ NAMING MISMATCH: Field name "r2_asset_manifest" is historical.
    // Previously tracked Cloudflare R2 object keys; now tracks local filesystem paths.
    // The field stores local paths like: /opt/content-forge/media/{channel}/{job}/{file}
    // Database column name kept to avoid migration; will be renamed in future cleanup phase.
    narration_source_path: text("narration_source_path"),
    /**
     * Asset manifest tracking all generated files
     * Default: [] (empty array) - No assets generated yet
     * Populated by asset-collection worker as images/audio are created
     * Each entry: { key: path, type: "image"|"audio"|"video", size_bytes: number }
     */
    r2_asset_manifest: jsonb("r2_asset_manifest")
      .$type<
        Array<{
          key: string;
          type: string;
          size_bytes: number;
          /**
           * Where the bytes live. Written by the render workflows and read by
           * the Drive-delivery scanner; it was always in the data and never in
           * this type, so every writer cast around it (W1 handoff §5).
           */
          storage_tier?: string;
        }>
      >()
      .notNull()
      .default([]),
    assembly_manifest: jsonb("assembly_manifest"),
    size_bytes_total_assets: bigint("size_bytes_total_assets", {
      mode: "number",
    }),

    // === Final video metrics ===
    final_video_size_bytes: bigint("final_video_size_bytes", {
      mode: "number",
    }),
    final_video_duration_seconds: integer("final_video_duration_seconds"),

    // === Artefact truth (migration 0048) ===
    // Authoritative on-disk path of the final render, written by worker-render
    // at completion. The artefact resolver PREFERS this when the file exists
    // and reports a discrepancy when it is set but the file is gone — never a
    // silent fallback. `artefacts_verified_at` / `artefacts_missing_count` are
    // written ONLY by reconcile-artefacts; NULL means "never reconciled",
    // which the UI shows as "never run" rather than a fabricated zero.
    final_video_path: text("final_video_path"),
    artefacts_verified_at: timestamp("artefacts_verified_at", {
      withTimezone: true,
    }),
    artefacts_missing_count: integer("artefacts_missing_count"),

    // === YouTube ===
    youtube_video_id: varchar("youtube_video_id", { length: 50 }),
    published_at: timestamp("published_at", { withTimezone: true }),
    views: integer("views"),
    revenue_cents: integer("revenue_cents"),

    // === QC review ===
    /**
     * Skip image quality control review
     * Default: false - Image QC review required (job waits at AWAITING_IMAGE_QC)
     * Set to true to auto-proceed through image generation without human review
     * Used for: Batch jobs, trusted formats, automated testing
     */
    skip_image_qc: boolean("skip_image_qc").notNull().default(false),
    /**
     * Skip final video quality control review
     * Default: false - Final QC review required (job waits at AWAITING_QC)
     * Set to true to auto-proceed to upload after render completes
     * Used for: Batch jobs, trusted pipelines, automated publishing
     */
    skip_final_qc: boolean("skip_final_qc").notNull().default(false),
    image_generation_mode: imageGenerationModeEnum("image_generation_mode")
      .notNull()
      .default("auto"),
    qc_feedback: text("qc_feedback"),
    qc_reviewed_at: timestamp("qc_reviewed_at", { withTimezone: true }),

    // === Job metadata ===
    // Generic JSONB for job-level context not covered by typed columns.
    // e.g. { style_asset_context: "..." } for illustration-mode jobs
    metadata: jsonb("metadata"),

    // === Generation log ===
    // Append-only audit log of every AI generation event in this job's lifecycle.
    // Each entry captures the exact prompt sent, raw model output, timing, and
    // success/failure. Costs near-zero storage but gives full reproducibility and
    // debuggability. Never overwritten — always appended.
    //
    // Entry shape:
    // {
    //   stage: "script" | "youtube_metadata" | "tts" | "scene_image" | ...
    //   started_at: ISO string
    //   completed_at: ISO string
    //   duration_ms: number
    //   model: string           // e.g. "claude-sonnet-4-6", "gemma3:4b"
    //   prompt_system?: string  // full system prompt sent to model
    //   prompt_user?: string    // full user prompt sent to model
    //   raw_output?: string     // raw model response (up to 10k chars)
    //   success: boolean
    //   error?: string
    // }
    /**
     * AI generation audit log
     * Default: [] (empty array) - No AI generations yet
     * Appended to for every AI call (Claude, Gemma, TTS, image gen)
     * Never cleared - permanent reproducibility and cost tracking record
     */
    generation_log: jsonb("generation_log")
      .$type<
        Array<{
          stage: string;
          started_at: string;
          completed_at: string;
          duration_ms: number;
          model: string;
          prompt_system?: string;
          prompt_user?: string;
          raw_output?: string;
          success: boolean;
          error?: string;
        }>
      >()
      .notNull()
      .default([]),

    // === Error handling ===
    error_message: text("error_message"),
    error_detail: jsonb("error_detail"),
    error_metadata: jsonb("error_metadata").$type<Record<string, unknown>>(),
    /**
     * Number of retry attempts for this job
     * Default: 0 - Job hasn't been retried yet
     * Incremented each time user manually retries a failed job
     * Used to detect retry loops and apply backoff strategies
     */
    retry_count: integer("retry_count").notNull().default(0),

    // === Worker lease (idempotency and concurrency control) ===
    worker_lease_id: uuid("worker_lease_id"),
    worker_lease_expires_at: timestamp("worker_lease_expires_at", {
      withTimezone: true,
    }),
    idempotency_key: uuid("idempotency_key"),

    // === Timestamps ===
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // B-tree indexes for frequent lookups
    statusIdx: index("content_jobs_status_idx").on(table.status),
    channelIdx: index("content_jobs_channel_id_idx").on(table.channel_id),
    templateIdx: index("content_jobs_template_id_idx").on(table.template_id),
    productionVaIdx: index("content_jobs_production_va_id_idx").on(
      table.assigned_production_va_id,
    ),
    uploaderVaIdx: index("content_jobs_uploader_va_id_idx").on(
      table.assigned_uploader_va_id,
    ),
    youtubeVideoIdx: index("content_jobs_youtube_video_id_idx").on(
      table.youtube_video_id,
    ),
  }),
);
