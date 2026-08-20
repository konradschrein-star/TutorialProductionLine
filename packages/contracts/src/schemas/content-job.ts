import { z } from "zod";
import { JobStatus } from "../enums/job-status.js";
import { ContentFormat } from "../enums/content-format.js";
import { RenderEngine } from "../enums/render-engine.js";
import { AssetManifestSchema } from "./asset-manifest.js";
import { AssemblyManifestSchema } from "./assembly-manifest.js";
import { ProductionVersion } from "../enums/production-version.js";

/**
 * Content Job Schema
 *
 * The central entity in the YouTube automation engine.
 * Represents a single piece of content moving through the pipeline.
 *
 * The database owns durable system state. This schema defines the
 * canonical shape of a job as it exists in PostgreSQL.
 *
 * Organized into logical sections:
 * - Identity: Core identifiers
 * - State tracking: Status, history, timestamps
 * - VA assignment: Human operator assignment and performance
 * - Content: Script, metadata, format
 * - Render: Engine selection, configuration, timing
 * - Assets: R2 manifest and storage metrics
 * - YouTube: Publishing metadata and telemetry
 * - Error handling: Failure state and retry tracking
 * - Worker lease: Idempotency and concurrency control
 */
export const ContentJobSchema = z.object({
  // === Identity ===
  id: z.string().uuid().describe("Unique job identifier"),
  channel_id: z.string().uuid().describe("YouTube channel this job belongs to"),
  template_id: z.string().uuid().describe("Template used for this job"),

  // === State tracking ===
  status: JobStatus.describe("Current job status"),
  paused_from_status: JobStatus.nullable().describe(
    "Status before PAUSED (enables auto-resume)"
  ),
  status_updated_at: z.string().datetime().describe("Timestamp of last status change"),
  state_machine_history: z
    .array(
      z.object({
        from_status: JobStatus,
        to_status: JobStatus,
        timestamp: z.string().datetime(),
        reason: z.string().optional(),
      })
    )
    .describe("Audit log of all state transitions"),

  // === VA assignment (human-in-the-loop) ===
  assigned_production_va_id: z
    .string()
    .uuid()
    .nullable()
    .describe("Production VA assigned to this job"),
  assigned_uploader_va_id: z
    .string()
    .uuid()
    .nullable()
    .describe("Uploader VA assigned to this job"),

  // === VA performance tracking ===
  production_va_time_spent_seconds: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Total time Production VA spent on this job"),
  uploader_va_time_spent_seconds: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Total time Uploader VA spent on this job"),

  // === Content ===
  production_version: ProductionVersion.describe(
    "Production version controlling composition complexity (V1=clean, V2=broadcast, V3=future)"
  ),
  format: ContentFormat.describe("Content format (EXPLAINER, DOCUMENTARY, etc.)"),
  title: z.string().min(1).max(100).describe("Video title"),
  description: z.string().max(5000).describe("Video description"),
  script: z.string().nullable().describe("Generated script text"),
  generated_tags: z
    .array(z.string())
    .describe("AI-generated tags for YouTube (stored as TEXT[] in PostgreSQL)"),

  // === Assembly ===
  assembly_manifest: AssemblyManifestSchema.nullable().describe(
    "Scene-level structure for video composition (populated during scene analysis)"
  ),
  duration_frames: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Total video duration in frames (populated during TTS generation)"),

  // === Render ===
  render_engine: RenderEngine.nullable().describe("Selected render engine (FFMPEG or REMOTION)"),
  aspect_ratio: z.enum(["16:9", "9:16"]).nullable().describe("Video aspect ratio"),
  target_duration_seconds: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Target video duration"),
  render_started_at: z
    .string()
    .datetime()
    .nullable()
    .describe("Timestamp when rendering began"),
  render_completed_at: z
    .string()
    .datetime()
    .nullable()
    .describe("Timestamp when rendering completed"),
  total_render_time_seconds: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Total render duration"),

  // === Assets ===
  r2_asset_manifest: AssetManifestSchema.describe(
    "JSONB array of all assets for this job (local filesystem paths)"
  ),
  size_bytes_total_assets: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Aggregate size of all assets in manifest"),

  // === Final video metrics ===
  final_video_size_bytes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Size of final rendered video"),
  final_video_duration_seconds: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Actual duration of final video"),

  // === YouTube ===
  youtube_video_id: z
    .string()
    .nullable()
    .describe("YouTube video ID after upload"),
  published_at: z
    .string()
    .datetime()
    .nullable()
    .describe("Timestamp of YouTube publication"),
  views: z.number().int().nonnegative().nullable().describe("YouTube view count"),
  revenue_cents: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Revenue in cents (for tracking)"),

  // === Error handling ===
  error_message: z.string().nullable().describe("Error message if job failed"),
  error_detail: z.record(z.unknown()).nullable().optional().describe("Structured error detail for app-level errors"),
  error_metadata: z.record(z.unknown()).nullable().optional().describe("Raw error metadata for dead letter queue"),
  retry_count: z.number().int().nonnegative().default(0).describe("Number of retry attempts"),

  // === Worker lease (idempotency and concurrency control) ===
  worker_lease_id: z
    .string()
    .uuid()
    .nullable()
    .describe("Worker that currently holds this job"),
  worker_lease_expires_at: z
    .string()
    .datetime()
    .nullable()
    .describe("Lease expiration timestamp"),
  idempotency_key: z
    .string()
    .uuid()
    .nullable()
    .describe("Unique key to prevent duplicate processing"),

  // === Timestamps ===
  created_at: z.string().datetime().describe("Job creation timestamp"),
  updated_at: z.string().datetime().describe("Last update timestamp"),
});

export type ContentJob = z.infer<typeof ContentJobSchema>;
