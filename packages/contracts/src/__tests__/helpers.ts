/**
 * Test helpers — factory functions for building valid test inputs.
 * Import from test files using relative paths with .js extension.
 */

// ─── ContentJob ───────────────────────────────────────────────────────────────

export function makeMinimalContentJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    channel_id: "00000000-0000-0000-0000-000000000002",
    template_id: "00000000-0000-0000-0000-000000000003",
    status: "SCRIPTING",
    paused_from_status: null,
    status_updated_at: "2026-04-01T00:00:00.000Z",
    state_machine_history: [],
    assigned_production_va_id: null,
    assigned_uploader_va_id: null,
    production_va_time_spent_seconds: null,
    uploader_va_time_spent_seconds: null,
    production_version: "V2",
    format: "EXPLAINER",
    title: "Test Video Title",
    description: "A test video description.",
    script: null,
    generated_tags: [],
    assembly_manifest: null,
    duration_frames: null,
    render_engine: null,
    aspect_ratio: null,
    target_duration_seconds: null,
    render_started_at: null,
    render_completed_at: null,
    total_render_time_seconds: null,
    r2_asset_manifest: [],
    size_bytes_total_assets: null,
    final_video_size_bytes: null,
    final_video_duration_seconds: null,
    youtube_video_id: null,
    published_at: null,
    views: null,
    revenue_cents: null,
    error_message: null,
    retry_count: 0,
    worker_lease_id: null,
    worker_lease_expires_at: null,
    idempotency_key: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── ContentTemplate ──────────────────────────────────────────────────────────

export function makeMinimalTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    name: "Test Template",
    format: "EXPLAINER",
    pipeline_stages: ["scripting", "tts", "render"],
    prompts: { scripting: "Write a script about {{topic}}" },
    render_config: {},
    required_assets: ["audio/tts"],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── IngestPayload ────────────────────────────────────────────────────────────

export function makeValidIngestPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel_id: "00000000-0000-0000-0000-000000000020",
    format: "EXPLAINER",
    template_id: "00000000-0000-0000-0000-000000000021",
    ...overrides,
  };
}
