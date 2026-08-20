/**
 * content_jobs repository tests
 *
 * Covers:
 * - Insert with minimum required fields
 * - Default field values (status, state_machine_history, r2_asset_manifest,
 *   generation_log, retry_count, skip_image_qc, skip_final_qc)
 * - Select by id
 * - Status update
 * - JSONB round-trips: assembly_manifest, r2_asset_manifest
 *
 * All tests are skipped automatically when DATABASE_TEST_URL is not set.
 */

import { eq } from "drizzle-orm";
import {
  describeDb,
  getTestDb,
  truncateAll,
  closeTestDb,
} from "../setup/test-db.js";
import {
  channels,
  contentTemplates,
  contentJobs,
} from "../../schema/index.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

async function insertChannel() {
  const db = getTestDb();
  const [channel] = await db
    .insert(channels)
    .values({
      youtube_channel_id: `yt-test-${crypto.randomUUID()}`,
      name: "Test Channel",
    })
    .returning();
  return channel!;
}

async function insertTemplate() {
  const db = getTestDb();
  const [template] = await db
    .insert(contentTemplates)
    .values({
      name: "Test Template",
      description: "A template for unit tests",
      format: "EXPLAINER",
      pipeline_stages: ["SCRIPTING", "RENDERING_FFMPEG"],
      prompts: { SCRIPTING: "Write a script about {{topic}}" },
      render_config: { engine: "FFMPEG", settings: {} },
      required_assets: [],
    })
    .returning();
  return template!;
}

async function insertMinimalJob(channelId: string, templateId: string) {
  const db = getTestDb();
  const [job] = await db
    .insert(contentJobs)
    .values({
      channel_id: channelId,
      template_id: templateId,
      status: "IDEA_GENERATION",
      status_updated_at: new Date(),
      format: "EXPLAINER",
      title: "Test Job Title",
      description: "Test job description",
    })
    .returning();
  return job!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeDb("content_jobs repository", () => {
  let channelId: string;
  let templateId: string;

  beforeAll(async () => {
    await truncateAll();
    const channel = await insertChannel();
    const template = await insertTemplate();
    channelId = channel.id;
    templateId = template.id;
  });

  beforeEach(async () => {
    // Only wipe jobs so channel + template fixtures survive the suite.
    const db = getTestDb();
    await db.delete(contentJobs);
  });

  afterAll(async () => {
    await truncateAll();
    await closeTestDb();
  });

  // -------------------------------------------------------------------------
  it("inserts a job with minimum required fields and retrieves it", async () => {
    const db = getTestDb();
    const inserted = await insertMinimalJob(channelId, templateId);

    expect(inserted).toBeDefined();
    expect(inserted.id).toBeTruthy();

    const [selected] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, inserted.id));

    expect(selected).toBeDefined();
    expect(selected!.channel_id).toBe(channelId);
    expect(selected!.template_id).toBe(templateId);
    expect(selected!.title).toBe("Test Job Title");
    expect(selected!.format).toBe("EXPLAINER");
  });

  // -------------------------------------------------------------------------
  it("persists the status set at insert time (IDEA_GENERATION)", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(job.status).toBe("IDEA_GENERATION");
  });

  // -------------------------------------------------------------------------
  it("defaults state_machine_history to an empty array", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(Array.isArray(job.state_machine_history)).toBe(true);
    expect(job.state_machine_history).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("defaults r2_asset_manifest to an empty array", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(Array.isArray(job.r2_asset_manifest)).toBe(true);
    expect(job.r2_asset_manifest).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("defaults generation_log to an empty array", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(Array.isArray(job.generation_log)).toBe(true);
    expect(job.generation_log).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("defaults retry_count to 0", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(job.retry_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  it("defaults production_version to V2", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(job.production_version).toBe("V2");
  });

  // -------------------------------------------------------------------------
  it("defaults skip_image_qc and skip_final_qc to false", async () => {
    const job = await insertMinimalJob(channelId, templateId);
    expect(job.skip_image_qc).toBe(false);
    expect(job.skip_final_qc).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("selects a job by id and returns the correct row", async () => {
    const db = getTestDb();
    const jobA = await insertMinimalJob(channelId, templateId);
    // Insert a second job to verify we select the right one.
    const jobB = await insertMinimalJob(channelId, templateId);

    const [selected] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobA.id));

    expect(selected!.id).toBe(jobA.id);
    expect(selected!.id).not.toBe(jobB.id);
  });

  // -------------------------------------------------------------------------
  it("updates the status field", async () => {
    const db = getTestDb();
    const job = await insertMinimalJob(channelId, templateId);

    await db
      .update(contentJobs)
      .set({ status: "SCRIPTING", status_updated_at: new Date() })
      .where(eq(contentJobs.id, job.id));

    const [updated] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job.id));

    expect(updated!.status).toBe("SCRIPTING");
  });

  // -------------------------------------------------------------------------
  it("round-trips an object stored in assembly_manifest (JSONB)", async () => {
    const db = getTestDb();
    const job = await insertMinimalJob(channelId, templateId);

    const manifest = {
      scenes: [
        { index: 0, duration_ms: 3000, narration: "Hello world" },
        { index: 1, duration_ms: 4500, narration: "Second scene" },
      ],
      total_duration_ms: 7500,
      version: 1,
    };

    await db
      .update(contentJobs)
      .set({ assembly_manifest: manifest })
      .where(eq(contentJobs.id, job.id));

    const [retrieved] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job.id));

    expect(retrieved!.assembly_manifest).toEqual(manifest);
  });

  // -------------------------------------------------------------------------
  it("round-trips entries stored in r2_asset_manifest (JSONB array)", async () => {
    const db = getTestDb();
    const job = await insertMinimalJob(channelId, templateId);

    const assetEntries = [
      { key: "ch-1/vid-1/audio/tts.mp3", type: "audio/tts", size_bytes: 102400 },
      { key: "ch-1/vid-1/video/final-render.mp4", type: "video/final-render", size_bytes: 52428800 },
    ];

    await db
      .update(contentJobs)
      .set({ r2_asset_manifest: assetEntries })
      .where(eq(contentJobs.id, job.id));

    const [retrieved] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job.id));

    expect(retrieved!.r2_asset_manifest).toEqual(assetEntries);
    expect(retrieved!.r2_asset_manifest).toHaveLength(2);
    expect(retrieved!.r2_asset_manifest[0]!.type).toBe("audio/tts");
    expect(retrieved!.r2_asset_manifest[1]!.size_bytes).toBe(52428800);
  });

  // -------------------------------------------------------------------------
  it("round-trips state_machine_history entries (JSONB array)", async () => {
    const db = getTestDb();
    const job = await insertMinimalJob(channelId, templateId);

    const history = [
      {
        from_status: "IDEA_GENERATION",
        to_status: "SCRIPTING",
        timestamp: new Date().toISOString(),
        reason: "auto-advance",
      },
    ];

    await db
      .update(contentJobs)
      .set({ state_machine_history: history })
      .where(eq(contentJobs.id, job.id));

    const [retrieved] = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, job.id));

    expect(retrieved!.state_machine_history).toHaveLength(1);
    expect(retrieved!.state_machine_history[0]!.from_status).toBe("IDEA_GENERATION");
    expect(retrieved!.state_machine_history[0]!.to_status).toBe("SCRIPTING");
  });
});
