import { vi, beforeEach } from "vitest";
import {
  makeMockDb,
  makeMockQueue,
  makeBullmqJob,
  makeDbTemplate,
} from "../helpers.js";

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
  validateWith: vi.fn().mockResolvedValue({ success: true }),
  PipelineValidationError: class PipelineValidationError extends Error {},
}));

vi.mock("@repo/config", () => ({
  getConfig: vi.fn().mockReturnValue({
    ANTHROPIC_API_KEY: "test-anthropic-key",
  }),
  isTestAgentMode: vi.fn().mockReturnValue(false),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createIngestProcessor } from "../../processors/ingest.js";
import { transitionJob } from "@repo/domain";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_ID = "00000000-0000-0000-0000-000000000002";
const TEMPLATE_ID = "00000000-0000-0000-0000-000000000010";
const NEW_JOB_ID = "00000000-0000-0000-0000-000000000099";

// ─── Base payload factory ─────────────────────────────────────────────────────

function makeIngestPayload(overrides: Record<string, unknown> = {}) {
  return {
    channel_id: CHANNEL_ID,
    format: "EXPLAINER",
    template_id: TEMPLATE_ID,
    ...overrides,
  };
}

// ─── Created job row (what DB returns after insert) ───────────────────────────

function makeCreatedJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NEW_JOB_ID,
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    status: "IDEA_GENERATION",
    format: "EXPLAINER",
    language: "en",
    production_version: "V2",
    title: "Untitled EXPLAINER",
    state_machine_history: [
      {
        from_status: "",
        to_status: "IDEA_GENERATION",
        timestamp: "2026-04-01T00:00:00.000Z",
        reason: "Job created via ingest queue",
      },
    ],
    r2_asset_manifest: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createIngestProcessor", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockAiGenerationQueue: ReturnType<typeof makeMockQueue>;
  let mockAssetCollectionQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockAiGenerationQueue = makeMockQueue();
    mockAssetCollectionQueue = makeMockQueue();

    // Default: valid transition for any status
    vi.mocked(transitionJob).mockReturnValue({
      success: true,
      value: "SCRIPTING" as any,
    });
  });

  // ─── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("throws when payload is missing channel_id", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      const job = makeBullmqJob({
        format: "EXPLAINER",
        template_id: TEMPLATE_ID,
      });

      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });

    it("throws when payload has invalid format", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      const job = makeBullmqJob(makeIngestPayload({ format: "COOKING_SHOW" }));

      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });

    it("throws when channel_id is not a valid UUID", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      const job = makeBullmqJob(
        makeIngestPayload({ channel_id: "not-a-uuid" }),
      );

      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });
  });

  // ─── Template validation ─────────────────────────────────────────────────

  describe("template validation", () => {
    it("throws when template is not found in DB", async () => {
      mockDb.limit.mockResolvedValue([]); // template not found

      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      const job = makeBullmqJob(makeIngestPayload());

      await expect(processor(job as any)).rejects.toThrow(
        `Template ${TEMPLATE_ID} not found`,
      );
    });

    it("throws when template is inactive", async () => {
      const template = makeDbTemplate({ is_active: false });
      mockDb.limit.mockResolvedValue([template]);

      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      const job = makeBullmqJob(makeIngestPayload());

      await expect(processor(job as any)).rejects.toThrow(
        `Template ${TEMPLATE_ID} is inactive`,
      );
    });
  });

  // ─── Job creation ────────────────────────────────────────────────────────

  describe("job creation", () => {
    beforeEach(() => {
      const template = makeDbTemplate();
      mockDb.limit.mockResolvedValue([template]);
      // insert().values().returning() → new job
      mockDb.returning.mockResolvedValue([makeCreatedJobRow()]);
      // update().set().where() chain — used for manifest update (no .returning() call here)
      // subsequent select + limit calls (from updateJobStatus / dispatchNext) also need rows
      mockDb.limit
        .mockResolvedValueOnce([template]) // template fetch
        .mockResolvedValue([makeCreatedJobRow({ status: "SCRIPTING" })]); // subsequent fetches
    });

    it("inserts a new content_jobs row", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
    });

    it("defaults language to 'en' when not provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.language).toBe("en");
    });

    it("respects explicit language when provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(makeIngestPayload({ language: "de" })) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.language).toBe("de");
    });

    it("defaults production_version to 'V2' when not provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.production_version).toBe("V2");
    });

    it("uses the provided production_version when specified", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(makeIngestPayload({ production_version: "V1" })) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.production_version).toBe("V1");
    });

    it("sets initial_topic on the job when provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ initial_topic: "Quantum Computing" }),
        ) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.initial_topic).toBe("Quantum Computing");
    });

    it("sets title to initial_topic when provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ initial_topic: "Quantum Computing" }),
        ) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.title).toBe("Quantum Computing");
    });

    it("sets title to 'Untitled {format}' when no initial_topic provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.title).toBe("Untitled EXPLAINER");
    });

    it("sets r2_asset_manifest to empty array when no pre_uploaded_assets", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      // The manifest update is done via db.update().set()
      const manifestUpdateCall = mockDb.set.mock.calls.find((args: any[]) =>
        Array.isArray(args[0]?.r2_asset_manifest),
      );
      expect(manifestUpdateCall).toBeDefined();
      const manifest = manifestUpdateCall?.[0]?.r2_asset_manifest;
      expect(manifest).toEqual([]);
    });
  });

  // ─── Script-provided path ────────────────────────────────────────────────

  describe("when script_text is provided", () => {
    beforeEach(() => {
      const template = makeDbTemplate();
      const createdJob = makeCreatedJobRow({
        script: "Pre-written script content.",
      });
      mockDb.limit
        .mockResolvedValueOnce([template])
        .mockResolvedValue([createdJob]);
      mockDb.returning.mockResolvedValue([createdJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "SCRIPTING" as any,
      });
    });

    it("stores the script_text in the content_jobs row", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ script_text: "Pre-written script content." }),
        ) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      expect(insertedValues?.script).toBe("Pre-written script content.");
    });

    it("dispatches to asset-collection queue, not scripting queue", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ script_text: "Pre-written script." }),
        ) as any,
      );

      // asset-collection queue should be called
      expect(mockAssetCollectionQueue.add).toHaveBeenCalled();
      // ai-generation for generate-script should NOT be the first add call
      const aiScriptCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-script",
      );
      expect(aiScriptCalls).toHaveLength(0);
    });

    it("dispatches youtube-metadata generation in parallel when script is pre-provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({
            script_text: "Pre-written script.",
            initial_topic: "Quantum Computing",
          }),
        ) as any,
      );

      const metadataCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "youtube-metadata",
      );
      expect(metadataCalls).toHaveLength(1);
      expect(metadataCalls[0]?.[1]).toMatchObject({
        generation_type: "youtube_metadata",
        job_id: NEW_JOB_ID,
      });
    });

    it("records SCRIPTING in state history reason when script is pre-provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ script_text: "Pre-written script." }),
        ) as any,
      );

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      const firstHistoryEntry = insertedValues?.state_machine_history?.[0];
      expect(firstHistoryEntry?.reason).toBe(
        "Job created with pre-written script",
      );
    });
  });

  // ─── No script path ──────────────────────────────────────────────────────

  describe("when script_text is not provided", () => {
    beforeEach(() => {
      const template = makeDbTemplate();
      const createdJob = makeCreatedJobRow({ script: null });
      mockDb.limit
        .mockResolvedValueOnce([template])
        .mockResolvedValue([createdJob]);
      mockDb.returning.mockResolvedValue([createdJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "SCRIPTING" as any,
      });
    });

    it("dispatches to ai-generation queue for script generation", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const generateScriptCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-script",
      );
      expect(generateScriptCalls).toHaveLength(1);
    });

    it("does NOT dispatch to asset-collection queue", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      expect(mockAssetCollectionQueue.add).not.toHaveBeenCalled();
    });

    it("records 'Job created via ingest queue' reason in initial history entry", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const insertedValues = mockDb.values.mock.calls[0]?.[0];
      const firstHistoryEntry = insertedValues?.state_machine_history?.[0];
      expect(firstHistoryEntry?.reason).toBe("Job created via ingest queue");
    });
  });

  // ─── pre_uploaded_assets ────────────────────────────────────────────────

  describe("pre_uploaded_assets", () => {
    beforeEach(() => {
      const template = makeDbTemplate();
      const createdJob = makeCreatedJobRow();
      mockDb.limit
        .mockResolvedValueOnce([template])
        .mockResolvedValue([createdJob]);
      mockDb.returning.mockResolvedValue([createdJob]);
      vi.mocked(transitionJob).mockReturnValue({
        success: true,
        value: "SCRIPTING" as any,
      });
    });

    it("adds pre_uploaded_assets to r2_asset_manifest", async () => {
      const preUploaded = [
        {
          key: "/media/ch1/job1/va-footage.mp4",
          type: "video/raw-va-footage",
          size_bytes: 104_857_600,
        },
      ];
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ pre_uploaded_assets: preUploaded }),
        ) as any,
      );

      const manifestUpdateCall = mockDb.set.mock.calls.find((args: any[]) =>
        Array.isArray(args[0]?.r2_asset_manifest),
      );
      const manifest = manifestUpdateCall?.[0]?.r2_asset_manifest;
      expect(manifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "/media/ch1/job1/va-footage.mp4",
            type: "video/raw-va-footage",
            size_bytes: 104_857_600,
          }),
        ]),
      );
    });

    it("manifest contains only pre_uploaded_assets (no thumbnail marker)", async () => {
      const preUploaded = [
        {
          key: "/media/ch1/job1/va-footage.mp4",
          type: "video/raw-va-footage",
          size_bytes: 104_857_600,
        },
      ];
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(
        makeBullmqJob(
          makeIngestPayload({ pre_uploaded_assets: preUploaded }),
        ) as any,
      );

      const manifestUpdateCall = mockDb.set.mock.calls.find((args: any[]) =>
        Array.isArray(args[0]?.r2_asset_manifest),
      );
      const manifest: any[] = manifestUpdateCall?.[0]?.r2_asset_manifest ?? [];
      expect(manifest).toHaveLength(1);
      expect(manifest[0]).toMatchObject({
        key: "/media/ch1/job1/va-footage.mp4",
        type: "video/raw-va-footage",
      });
    });

    it("manifest is empty when no pre_uploaded_assets provided", async () => {
      const processor = createIngestProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });
      await processor(makeBullmqJob(makeIngestPayload()) as any);

      const manifestUpdateCall = mockDb.set.mock.calls.find((args: any[]) =>
        Array.isArray(args[0]?.r2_asset_manifest),
      );
      const manifest: any[] = manifestUpdateCall?.[0]?.r2_asset_manifest ?? [];
      expect(manifest).toHaveLength(0);
    });
  });
});
