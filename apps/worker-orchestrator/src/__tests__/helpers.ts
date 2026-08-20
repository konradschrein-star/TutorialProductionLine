import { vi } from "vitest";
import type { Job } from "bullmq";

/**
 * Shared test helpers for worker-orchestrator tests.
 * Factory functions only — no test cases in this file.
 */

// ─── Mock DB ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock DrizzleClient that supports chained selects and transactions.
 *
 * Defaults:
 * - `.limit()` resolves to [] (no rows found)
 * - `.returning()` resolves to [] (no rows returned)
 * - `.transaction()` immediately calls the callback with mockDb itself
 */
export function makeMockDb() {
  const mockDb: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: any) => any) => fn(mockDb)),
  };
  return mockDb;
}

// ─── Mock Queue ───────────────────────────────────────────────────────────────

export function makeMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: "test-bullmq-job-id" }),
    getJob: vi.fn().mockResolvedValue(null),
  };
}

// ─── BullMQ Job ───────────────────────────────────────────────────────────────

export function makeBullmqJob<T>(data: T, id = "test-job-id"): Job<T> {
  return { id, data, attemptsMade: 0 } as unknown as Job<T>;
}

// ─── DB Row Factories ─────────────────────────────────────────────────────────

/**
 * Returns a plain object matching the content_jobs DB row shape.
 * Defaults to a V2 EXPLAINER job in SCRIPTING status with a valid
 * state_machine_history entry so updateJobStatus can append to it.
 */
export function makeDbJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    channel_id: "00000000-0000-0000-0000-000000000002",
    template_id: "00000000-0000-0000-0000-000000000010",
    status: "SCRIPTING",
    paused_from_status: null,
    status_updated_at: new Date("2026-04-01T00:00:00.000Z"),
    state_machine_history: [
      {
        from_status: "IDEA_GENERATION",
        to_status: "SCRIPTING",
        timestamp: "2026-04-01T00:00:00.000Z",
        reason: "Job created via ingest queue",
      },
    ],
    assigned_production_va_id: null,
    assigned_uploader_va_id: null,
    production_va_time_spent_seconds: null,
    uploader_va_time_spent_seconds: null,
    production_version: "V2",
    format: "EXPLAINER",
    language: "en",
    initial_topic: "Quantum Computing",
    title: "Quantum Computing Explained",
    description:
      "A thorough explanation of quantum computing fundamentals and real-world applications.",
    script: "This is a sample script about quantum computing. ".repeat(5),
    generated_tags: ["quantum", "computing", "tech"],
    render_engine: null,
    aspect_ratio: null,
    target_duration_seconds: null,
    duration_frames: null,
    render_started_at: null,
    render_completed_at: null,
    total_render_time_seconds: null,
    narration_source_path: null,
    r2_asset_manifest: [],
    assembly_manifest: null,
    size_bytes_total_assets: null,
    final_video_size_bytes: null,
    final_video_duration_seconds: null,
    youtube_video_id: null,
    published_at: null,
    views: null,
    revenue_cents: null,
    skip_image_qc: false,
    skip_final_qc: false,
    qc_feedback: null,
    qc_reviewed_at: null,
    metadata: null,
    generation_log: [],
    error_message: null,
    error_detail: null,
    retry_count: 0,
    worker_lease_id: null,
    worker_lease_expires_at: null,
    idempotency_key: null,
    created_at: new Date("2026-04-01T00:00:00.000Z"),
    updated_at: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Returns a plain object matching the content_templates DB row shape.
 * Defaults to an active EXPLAINER template requiring audio/tts and script.
 */
export function makeDbTemplate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    name: "Test Explainer Template",
    description: "Test template for unit tests.",
    format: "EXPLAINER",
    pipeline_stages: ["scripting", "tts", "render"],
    prompts: { scripting: "Write a script about {{topic}}" },
    render_config: { engine: "FFMPEG", settings: {} },
    required_assets: ["script", "audio/tts"],
    metadata: null,
    is_active: true,
    created_at: new Date("2026-04-01T00:00:00.000Z"),
    updated_at: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}
