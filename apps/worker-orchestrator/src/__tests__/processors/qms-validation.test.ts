import { vi, beforeEach } from "vitest";
import { makeMockDb, makeMockQueue, makeBullmqJob, makeDbJob, makeDbTemplate } from "../helpers.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@repo/db", () => ({
  contentJobs: "contentJobs_table",
  contentTemplates: "contentTemplates_table",
  systemEvents: "systemEvents_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
}));

vi.mock("@repo/domain", () => ({
  transitionJob: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createQMSValidationProcessor } from "../../processors/qms-validation.js";
import { transitionJob } from "@repo/domain";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "00000000-0000-0000-0000-000000000001";
const TEMPLATE_ID = "00000000-0000-0000-0000-000000000010";

function makeQMSBullJob(stage: string) {
  return makeBullmqJob({ job_id: JOB_ID, validation_stage: stage });
}

// ─── Job factories ────────────────────────────────────────────────────────────

/**
 * V1 job ready for pre-render: valid script + audio/tts + 2 broll images for 2 scenes.
 */
function makeReadyForRenderJob(overrides: Record<string, unknown> = {}) {
  return makeDbJob({
    status: "QMS_VALIDATING",
    state_machine_history: [
      { from_status: "ASSET_COLLECTION", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
    ],
    script: "This is a valid script that has more than one hundred characters in it to satisfy the minimum length check.",
    r2_asset_manifest: [
      { key: "/media/ch1/job1/audio_tts.mp3", type: "audio/tts", size_bytes: 500_000 },
      { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
      { key: "/media/ch1/job1/scene_1.jpg", type: "image/broll", size_bytes: 100_000 },
    ],
    assembly_manifest: { scenes: [{ scene_index: 0 }, { scene_index: 1 }] },
    production_version: "V1",
    ...overrides,
  });
}

/** Job ready for pre-upload QMS */
function makeReadyForUploadJob(overrides: Record<string, unknown> = {}) {
  return makeDbJob({
    status: "QMS_VALIDATING",
    state_machine_history: [
      { from_status: "AWAITING_QC", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
    ],
    title: "Quantum Computing Explained",
    description: "A thorough explanation of quantum computing fundamentals and real-world applications for the YouTube audience.",
    generated_tags: ["quantum", "tech"],
    r2_asset_manifest: [
      { key: "/media/ch1/job1/final.mp4", type: "video/final-render", size_bytes: 50_000_000 },
    ],
    ...overrides,
  });
}

// ─── Mock DB setup helper ─────────────────────────────────────────────────────
//
// The QMS processor makes these DB calls in order:
//   1. select from contentJobs (job fetch)           → mockDb.limit call 1
//   2. select from contentTemplates (template fetch) → mockDb.limit call 2
//   3. If validation fails: updateJobStatus() calls:
//      a. select from contentJobs (job fetch again)  → mockDb.limit call 3
//      b. db.transaction → update().set().where().returning() (job update)
//                        → insert().values() (system event)
//   4. If validation passes (pre-render): updateJobStatusAndDispatch() calls:
//      - updateJobStatus (same as 3 above)
//      - dispatchNext → select from contentJobs (job fetch) → mockDb.limit call 4
//
// So we must mock limit() with enough sequential return values.

function setupMockDb(
  mockDb: ReturnType<typeof makeMockDb>,
  dbJob: Record<string, unknown>,
  template: Record<string, unknown>,
) {
  const updatedJob = { ...dbJob, status: dbJob.status }; // returned from transaction
  // Calls: 1=job fetch, 2=template fetch, 3=job fetch inside updateJobStatus, 4+=subsequent fetches
  mockDb.limit
    .mockResolvedValueOnce([dbJob])     // 1. QMS: fetch job
    .mockResolvedValueOnce([template])  // 2. QMS: fetch template
    .mockResolvedValue([dbJob]);        // 3+. updateJobStatus / dispatchNext fetches
  // transaction: update().returning() → return updated job
  mockDb.returning.mockResolvedValue([updatedJob]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createQMSValidationProcessor", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockRenderHeavyQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockRenderHeavyQueue = makeMockQueue();

    // Default: valid transition for any status update
    vi.mocked(transitionJob).mockReturnValue({ success: true, value: "ROUTING_RENDER" as any });
  });

  // ─── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("throws when payload is missing job_id", async () => {
      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      const job = makeBullmqJob({ validation_stage: "pre-render" }); // missing job_id

      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });

    it("throws when validation_stage is not a recognized enum value", async () => {
      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      const job = makeBullmqJob({ job_id: JOB_ID, validation_stage: "pre-magic" });

      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });

    it("throws when job is not found in DB", async () => {
      mockDb.limit.mockResolvedValue([]); // no job
      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });

      await expect(processor(makeQMSBullJob("pre-render") as any)).rejects.toThrow(
        `Job ${JOB_ID} not found`
      );
    });

    it("throws when template is not found in DB", async () => {
      const dbJob = makeReadyForRenderJob();
      mockDb.limit
        .mockResolvedValueOnce([dbJob])  // job found
        .mockResolvedValue([]);           // template not found

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });

      await expect(processor(makeQMSBullJob("pre-render") as any)).rejects.toThrow(
        `Template ${TEMPLATE_ID} not found`
      );
    });
  });

  // ─── pre-render stage ─────────────────────────────────────────────────────

  describe("pre-render stage", () => {
    it("passes validation and dispatches to render-heavy queue when all conditions are met", async () => {
      const dbJob = makeReadyForRenderJob();
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      // No FAILED_QMS transition
      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
      // Dispatched to render-heavy queue
      expect(mockRenderHeavyQueue.add).toHaveBeenCalled();
    });

    it("sets FAILED_QMS when a required R2 asset type is missing from the manifest", async () => {
      const dbJob = makeReadyForRenderJob({
        r2_asset_manifest: [
          // audio/tts missing — only broll present
          { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
          { key: "/media/ch1/job1/scene_1.jpg", type: "image/broll", size_bytes: 100_000 },
        ],
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when script is required but missing", async () => {
      const dbJob = makeReadyForRenderJob({ script: null });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when script is too short (under 100 chars)", async () => {
      const dbJob = makeReadyForRenderJob({ script: "Too short." });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when assembly_manifest exists but has zero scenes", async () => {
      const dbJob = makeReadyForRenderJob({ assembly_manifest: { scenes: [] } });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when an asset has size_bytes of 0", async () => {
      const dbJob = makeReadyForRenderJob({
        r2_asset_manifest: [
          { key: "/media/ch1/job1/audio_tts.mp3", type: "audio/tts", size_bytes: 0 },
          { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
          { key: "/media/ch1/job1/scene_1.jpg", type: "image/broll", size_bytes: 100_000 },
        ],
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it('skips the size check for assets with key "skipped" (thumbnail exempt)', async () => {
      const dbJob = makeReadyForRenderJob({
        r2_asset_manifest: [
          { key: "/media/ch1/job1/audio_tts.mp3", type: "audio/tts", size_bytes: 500_000 },
          { key: "skipped", type: "image/thumbnail", size_bytes: 0 }, // must NOT trigger FAILED_QMS
          { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
          { key: "/media/ch1/job1/scene_1.jpg", type: "image/broll", size_bytes: 100_000 },
        ],
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
    });

    it("sets FAILED_QMS for V1 job with no broll images", async () => {
      const dbJob = makeReadyForRenderJob({
        production_version: "V1",
        r2_asset_manifest: [
          // audio/tts present but no image/broll
          { key: "/media/ch1/job1/audio_tts.mp3", type: "audio/tts", size_bytes: 500_000 },
        ],
        assembly_manifest: { scenes: [{ scene_index: 0 }, { scene_index: 1 }] },
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS for V1 job when broll count is less than scene count", async () => {
      const dbJob = makeReadyForRenderJob({
        production_version: "V1",
        r2_asset_manifest: [
          { key: "/media/ch1/job1/audio_tts.mp3", type: "audio/tts", size_bytes: 500_000 },
          { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
          // 1 broll for 3 scenes
        ],
        assembly_manifest: { scenes: [{ scene_index: 0 }, { scene_index: 1 }, { scene_index: 2 }] },
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("uses the latest manifest entry per type for size check (stale zero-size entry is ignored)", async () => {
      // Two audio/tts entries — the later non-zero entry should win → no FAILED_QMS
      const dbJob = makeReadyForRenderJob({
        r2_asset_manifest: [
          { key: "/media/old/audio_tts.mp3", type: "audio/tts", size_bytes: 0 },    // stale
          { key: "/media/new/audio_tts.mp3", type: "audio/tts", size_bytes: 500_000 }, // latest
          { key: "/media/ch1/job1/scene_0.jpg", type: "image/broll", size_bytes: 100_000 },
          { key: "/media/ch1/job1/scene_1.jpg", type: "image/broll", size_bytes: 100_000 },
        ],
      });
      const template = makeDbTemplate({ required_assets: ["script", "audio/tts"] });
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, { renderHeavy: mockRenderHeavyQueue as any });
      await processor(makeQMSBullJob("pre-render") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
    });
  });

  // ─── pre-upload stage ─────────────────────────────────────────────────────

  describe("pre-upload stage", () => {
    it("passes when final video, title, long description, and tags are all present", async () => {
      const dbJob = makeReadyForUploadJob();
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
    });

    it("sets FAILED_QMS when final video is missing from manifest", async () => {
      const dbJob = makeReadyForUploadJob({ r2_asset_manifest: [] });
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when title is empty", async () => {
      const dbJob = makeReadyForUploadJob({ title: "" });
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when title is whitespace-only", async () => {
      const dbJob = makeReadyForUploadJob({ title: "   " });
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when description is shorter than 100 chars", async () => {
      const dbJob = makeReadyForUploadJob({ description: "Too short." });
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when generated_tags is empty", async () => {
      const dbJob = makeReadyForUploadJob({ generated_tags: [] });
      const template = makeDbTemplate({ required_assets: [] });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-upload") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });
  });

  // ─── pre-ai-generation stage ──────────────────────────────────────────────

  describe("pre-ai-generation stage", () => {
    it("sets FAILED_QMS when job has no script and no topic", async () => {
      const dbJob = makeDbJob({
        status: "QMS_VALIDATING",
        state_machine_history: [
          { from_status: "IDEA_GENERATION", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
        ],
        script: null,
        initial_topic: null,
        title: "Untitled EXPLAINER", // placeholder — triggers "no topic" check
        metadata: null,
      });
      const template = makeDbTemplate({ is_active: true });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-ai-generation") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("sets FAILED_QMS when template is inactive", async () => {
      const dbJob = makeDbJob({
        status: "QMS_VALIDATING",
        state_machine_history: [
          { from_status: "IDEA_GENERATION", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
        ],
        initial_topic: "Quantum Computing",
      });
      const template = makeDbTemplate({ is_active: false });
      setupMockDb(mockDb, dbJob, template);
      vi.mocked(transitionJob).mockReturnValue({ success: true, value: "FAILED_QMS" as any });

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-ai-generation") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(true);
    });

    it("passes when job has initial_topic and template is active", async () => {
      const dbJob = makeDbJob({
        status: "QMS_VALIDATING",
        state_machine_history: [
          { from_status: "IDEA_GENERATION", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
        ],
        initial_topic: "Quantum Computing",
        script: null,
      });
      const template = makeDbTemplate({ is_active: true });
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, {});
      await processor(makeQMSBullJob("pre-ai-generation") as any);

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
    });
  });

  // ─── pre-state-transition stage ───────────────────────────────────────────

  describe("pre-state-transition stage", () => {
    it("passes with no errors (currently a pass-through stage with no checks)", async () => {
      const dbJob = makeDbJob({
        status: "QMS_VALIDATING",
        state_machine_history: [
          { from_status: "ASSET_COLLECTION", to_status: "QMS_VALIDATING", timestamp: "2026-04-01T00:00:00.000Z" },
        ],
      });
      const template = makeDbTemplate();
      setupMockDb(mockDb, dbJob, template);

      const processor = createQMSValidationProcessor(mockDb, {});
      await expect(processor(makeQMSBullJob("pre-state-transition") as any)).resolves.not.toThrow();

      const setCalls = mockDb.set.mock.calls;
      expect(setCalls.some((args: any[]) => args[0]?.status === "FAILED_QMS")).toBe(false);
    });
  });
});
