import { vi, beforeEach, describe, it, expect } from "vitest";
import {
  makeMockDb,
  makeMockQueue,
  makeBullmqJob,
  makeDbJob,
  makeDbTemplate,
} from "../helpers.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@repo/db", () => ({
  contentJobs: "contentJobs_table",
  contentTemplates: "contentTemplates_table",
  assets: "assets_table",
  systemEvents: "systemEvents_table",
  clipLibraryConfigs: "clipLibraryConfigs_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
  and: vi.fn((...args: unknown[]) => `and(${args.join(",")})`),
  isNull: vi.fn(() => "isNull_condition"),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _isSQLQuery: true,
    strings,
    values,
  })),
}));

vi.mock("@repo/contracts", () => ({
  getPacingConfig: vi.fn().mockReturnValue({
    hook_use_subsentences: true,
    early_body_end_pct: 50,
    early_body_end_seconds: 480,
    late_body_sentences_per_image_min: 2,
    late_body_sentences_per_image_max: 4,
    max_image_duration_seconds: 30,
    key_fact_trigger: "content_detection",
  }),
  getPacingZone: vi.fn().mockReturnValue("early_body"),
  buildErrorDetail: vi.fn((opts: Record<string, unknown>) => ({
    code: opts.code,
    message: opts.message,
    category: opts.category,
    retryable: opts.retryable,
    context: opts.context,
  })),
}));

vi.mock("@repo/config", () => ({
  loadConfig: vi.fn().mockReturnValue({
    AI33_API_KEY: "test-ai33-key",
    DEFAULT_VOICE_EN: "test-voice-en",
    DEFAULT_VOICE_DE: "test-voice-de",
  }),
}));

vi.mock("@repo/domain", () => ({
  transitionJob: vi
    .fn()
    .mockReturnValue({ success: true, value: "QMS_VALIDATING" }),
  resolveAssets: vi.fn().mockReturnValue({ tiers: [], asset_types: [] }),
}));

// Mock updateJobStatus — the asset-collection processor calls this directly
vi.mock("../../utils/update-job-status.js", () => ({
  updateJobStatus: vi
    .fn()
    .mockResolvedValue({ id: "test-job-id", status: "QMS_VALIDATING" }),
}));

// Mock the per-video asset assembly utility
vi.mock("../../utils/per-video-assets.js", () => ({
  assemblePerVideoAssets: vi.fn().mockResolvedValue({
    style_guide: undefined,
    characters: [],
    backgrounds: [],
  }),
}));

// Mock auto image QC utility
vi.mock("../../utils/image-qc.js", () => ({
  runAutoImageQc: vi.fn().mockReturnValue({
    total: 0,
    passedCount: 0,
    failedCount: 0,
    failedKeys: [],
    autoApproved: true,
  }),
}));

// Mock node:path — use importOriginal to preserve all built-ins; override join for tests
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    join: vi.fn((...parts: string[]) => parts.join("/")),
  };
});

// Mock node:child_process — the narration-source branch spawns a real ffmpeg
// to extract PCM audio for Whisper (see "Whisper-on-narration" in
// asset-collection.ts). Tests that set narration_source_path to a fixture
// path that doesn't exist on disk need this to succeed without a real binary.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: (event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0);
    },
  })),
}));

// Mock @repo/media-core — generateASSFile isn't exercised by these tests;
// runWhisper backs the narration-source Whisper transcription triggered
// whenever narration_source_path is set without existing word_timestamps.
vi.mock("@repo/media-core", () => ({
  generateASSFile: vi.fn(),
  runWhisper: vi.fn().mockResolvedValue([{ word: "Test", start: 0, end: 0.5 }]),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createAssetCollectionProcessor } from "../../processors/asset-collection.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import {
  getPacingConfig,
  getPacingZone,
  buildErrorDetail,
} from "@repo/contracts";
import { runAutoImageQc } from "../../utils/image-qc.js";

// ─── Re-export the pure functions under test for isolated unit tests ──────────
// assignGroups and splitIntoClauseSentenceImages are NOT exported from the processor
// module. We test them indirectly through the processor's scene dispatch behaviour.
// If they become exported utilities, add a direct import here.

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "00000000-0000-0000-0000-000000000001";
const CHANNEL_ID = "00000000-0000-0000-0000-000000000002";
const TEMPLATE_ID = "00000000-0000-0000-0000-000000000010";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return makeDbJob({
    id: JOB_ID,
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    status: "ASSET_COLLECTION",
    script: "This is the narration script. ".repeat(10),
    r2_asset_manifest: [],
    assembly_manifest: null,
    narration_source_path: null,
    ...overrides,
  });
}

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return makeDbTemplate({
    id: TEMPLATE_ID,
    metadata: { pipeline_config: {} },
    render_config: { engine: "FFMPEG", settings: {} },
    ...overrides,
  });
}

function makeSentenceImage(
  overrides: Partial<{
    sentence_text: string;
    image_prompt: string;
    enriched_image_prompt: string | null;
    is_key_fact: boolean;
    key_fact_text: string | null;
    group_index: number | null;
    r2_key: string | null;
  }> = {},
) {
  return {
    sentence_text: "A sentence about the topic.",
    image_prompt: "A person explaining the topic",
    enriched_image_prompt: null,
    is_key_fact: false,
    key_fact_text: null,
    group_index: null,
    r2_key: null,
    ...overrides,
  };
}

function makeScene(
  scene_index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    scene_index,
    visual_type: "BROLL",
    paragraph: "A paragraph about the topic. Another sentence here.",
    sentence_images: [makeSentenceImage()],
    ...overrides,
  };
}

function makeAssemblyManifest(scenes: unknown[] = [makeScene(0)]) {
  return { scenes };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createAssetCollectionProcessor", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockAiGenerationQueue: ReturnType<typeof makeMockQueue>;
  let mockAssetCollectionQueue: ReturnType<typeof makeMockQueue>;
  let mockSceneAnalysisQueue: ReturnType<typeof makeMockQueue>;
  let mockQmsValidationQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockAiGenerationQueue = makeMockQueue();
    mockAssetCollectionQueue = makeMockQueue();
    mockSceneAnalysisQueue = makeMockQueue();
    mockQmsValidationQueue = makeMockQueue();

    // Default: getPacingZone returns early_body for all scenes
    vi.mocked(getPacingZone).mockReturnValue("early_body");
  });

  // ─── Happy path: TTS-based pipeline ──────────────────────────────────────

  describe("TTS-based pipeline (no scene analysis required)", () => {
    it("dispatches TTS generation when no audio/tts entry in manifest", async () => {
      const jobRow = makeJobRow({ r2_asset_manifest: [] });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const ttsCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-tts",
      );
      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0]![1]).toMatchObject({
        generation_type: "tts",
        job_id: JOB_ID,
        voice_id: "test-voice-en",
      });
    });

    it("does NOT dispatch TTS when audio/tts is already present in manifest", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 1024,
          },
        ],
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const ttsCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-tts",
      );
      expect(ttsCalls).toHaveLength(0);
    });

    it("skips TTS when no_tts is true in pipeline_config", async () => {
      const jobRow = makeJobRow({ r2_asset_manifest: [] });
      const template = makeTemplateRow({
        metadata: { pipeline_config: { no_tts: true } },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const ttsCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-tts",
      );
      expect(ttsCalls).toHaveLength(0);
    });

    it("skips TTS when narration_source_path is already set on the job", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [],
        narration_source_path: "/media/ch1/job1/narration.wav",
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const ttsCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "generate-tts",
      );
      expect(ttsCalls).toHaveLength(0);
    });

    it("throws when job has no script and TTS is required", async () => {
      const jobRow = makeJobRow({ script: null, r2_asset_manifest: [] });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await expect(processor(job as any)).rejects.toThrow(
        `Job ${JOB_ID} has no script for TTS`,
      );

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        `Job ${JOB_ID} has no script for TTS`,
        expect.objectContaining({ code: "ASSET_COLLECTION_FAILED" }),
      );
    });
  });

  // ─── Convergence: TTS present → advance to QMS ────────────

  describe("convergence: all non-scene assets present", () => {
    it("transitions to QMS_VALIDATING when TTS is present", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "QMS_VALIDATING",
      );
    });

    it("dispatches validate-pre-render to qmsValidation queue when provided", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(mockQmsValidationQueue.add).toHaveBeenCalledWith(
        "validate-pre-render",
        expect.objectContaining({
          job_id: JOB_ID,
          validation_stage: "pre-render",
        }),
      );
    });

    it("transitions to AWAITING_PRODUCTION_VA when awaiting_va_after_automated and no VA footage", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
      });
      const template = makeTemplateRow({
        metadata: {
          pipeline_config: {
            no_tts: true,
            awaiting_va_after_automated: true,
          },
        },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "AWAITING_PRODUCTION_VA",
      );
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("calls updateJobStatus with FAILED_GENERAL and rethrows when job is not found", async () => {
      mockDb.limit.mockResolvedValue([]); // no job

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await expect(processor(job as any)).rejects.toThrow(
        `Job ${JOB_ID} not found`,
      );

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        `Job ${JOB_ID} not found`,
        expect.objectContaining({
          code: "ASSET_COLLECTION_FAILED",
          retryable: true,
        }),
      );
    });

    it("calls updateJobStatus with FAILED_GENERAL and rethrows when template is not found", async () => {
      const jobRow = makeJobRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow]) // job found
        .mockResolvedValueOnce([]); // template not found

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await expect(processor(job as any)).rejects.toThrow(
        `Template ${TEMPLATE_ID} not found`,
      );

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        `Template ${TEMPLATE_ID} not found`,
        expect.objectContaining({ code: "ASSET_COLLECTION_FAILED" }),
      );
    });
  });

  // ─── Scene analysis gate ──────────────────────────────────────────────────

  describe("needs_scene_analysis gate", () => {
    it("dispatches to scene-analysis queue when needs_scene_analysis=true and no assembly_manifest", async () => {
      const jobRow = makeJobRow({
        script: "A script about the topic. ".repeat(10),
        assembly_manifest: null,
      });
      const template = makeTemplateRow({
        metadata: { pipeline_config: { needs_scene_analysis: true } },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        sceneAnalysis: mockSceneAnalysisQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(mockSceneAnalysisQueue.add).toHaveBeenCalledWith(
        "analyze-scenes",
        expect.objectContaining({
          job_id: JOB_ID,
          template_id: TEMPLATE_ID,
          script: expect.stringContaining("topic"),
        }),
      );
    });

    it("throws when needs_scene_analysis=true but no sceneAnalysis queue is provided", async () => {
      const jobRow = makeJobRow({ assembly_manifest: null });
      const template = makeTemplateRow({
        metadata: { pipeline_config: { needs_scene_analysis: true } },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        // no sceneAnalysis queue
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await expect(processor(job as any)).rejects.toThrow(
        "scene-analysis queue not provided but template requires it",
      );
    });

    it("throws when needs_scene_analysis=true but job has no script", async () => {
      const jobRow = makeJobRow({ script: null, assembly_manifest: null });
      const template = makeTemplateRow({
        metadata: { pipeline_config: { needs_scene_analysis: true } },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        sceneAnalysis: mockSceneAnalysisQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await expect(processor(job as any)).rejects.toThrow(
        `Job ${JOB_ID} has no script — cannot run scene analysis`,
      );
    });

    it("does NOT dispatch scene-analysis when assembly_manifest already has scenes", async () => {
      const manifest = makeAssemblyManifest([makeScene(0)]);
      const jobRow = makeJobRow({
        assembly_manifest: manifest,
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
      });
      const template = makeTemplateRow({
        metadata: { pipeline_config: { needs_scene_analysis: true } },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      // transaction mock for persistManifest
      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txMock = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: JOB_ID }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(txMock);
      });

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        sceneAnalysis: mockSceneAnalysisQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(mockSceneAnalysisQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── Scene image dispatch ─────────────────────────────────────────────────

  describe("scene image dispatch from assembly_manifest", () => {
    it("dispatches one sentence_image job per scene group head without r2_key", async () => {
      const manifest = makeAssemblyManifest([
        makeScene(0, {
          sentence_images: [
            makeSentenceImage({ group_index: 0, r2_key: null }),
            makeSentenceImage({ group_index: 1, r2_key: null }),
          ],
        }),
      ]);
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
        assembly_manifest: manifest,
        narration_source_path: "/media/ch1/job1/narration.wav", // skip TTS
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      // transaction mock for persistManifest (group assignment persistence)
      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txMock = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: JOB_ID }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(txMock);
      });

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const sceneCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => String(args[0]).startsWith("generate-scene-image-"),
      );
      expect(sceneCalls).toHaveLength(2); // one per group head
    });

    it("does NOT dispatch sentence_image for a sentence already having r2_key", async () => {
      const manifest = makeAssemblyManifest([
        makeScene(0, {
          sentence_images: [
            makeSentenceImage({
              group_index: 0,
              r2_key: "/media/ch1/job1/scene_0_img_0.png", // already generated
            }),
          ],
        }),
      ]);
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
        assembly_manifest: manifest,
        narration_source_path: "/media/ch1/job1/narration.wav",
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txMock = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: JOB_ID }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(txMock);
      });

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const sceneCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => String(args[0]).startsWith("generate-scene-image-"),
      );
      expect(sceneCalls).toHaveLength(0);
    });

    it("skips AVATAR_ON_CAMERA scenes in non-hook zones", async () => {
      // Make getPacingZone return non-hook for scene 0
      vi.mocked(getPacingZone).mockReturnValue("early_body");

      const manifest = makeAssemblyManifest([
        makeScene(0, {
          visual_type: "AVATAR_ON_CAMERA",
          sentence_images: [
            makeSentenceImage({ group_index: 0, r2_key: null }),
          ],
        }),
      ]);
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
        assembly_manifest: manifest,
        narration_source_path: "/media/ch1/job1/narration.wav",
      });
      const template = makeTemplateRow();
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txMock = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: JOB_ID }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(txMock);
      });

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      const sceneCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => String(args[0]).startsWith("generate-scene-image-"),
      );
      expect(sceneCalls).toHaveLength(0);
    });
  });

  // ─── Image QC routing ─────────────────────────────────────────────────────

  describe("image QC routing", () => {
    it("routes to AWAITING_IMAGE_QC when auto-QC fails", async () => {
      vi.mocked(runAutoImageQc).mockReturnValueOnce({
        total: 5,
        passedCount: 3,
        failedCount: 2,
        failedKeys: ["/media/ch1/job1/scene_1_broll.png"],
        autoApproved: false,
      });

      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
          {
            key: "/media/ch1/job1/scene_0_broll.png",
            type: "image/broll",
            size_bytes: 120_000,
          },
          {
            key: "/media/ch1/job1/scene_1_broll.png",
            type: "image/broll",
            size_bytes: 100,
          },
        ],
        skip_image_qc: false,
      });
      const template = makeTemplateRow({
        render_config: {
          engine: "FFMPEG",
          qc_image_review_required: true,
          settings: {},
        },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "AWAITING_IMAGE_QC",
      );
    });

    it("proceeds to QMS when auto-QC passes (within tolerance)", async () => {
      vi.mocked(runAutoImageQc).mockReturnValueOnce({
        total: 5,
        passedCount: 5,
        failedCount: 0,
        failedKeys: [],
        autoApproved: true,
      });

      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
          {
            key: "/media/ch1/job1/scene_0_broll.png",
            type: "image/broll",
            size_bytes: 200_000,
          },
        ],
        skip_image_qc: false,
      });
      const template = makeTemplateRow({
        render_config: {
          engine: "FFMPEG",
          qc_image_review_required: true,
          settings: {},
        },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "QMS_VALIDATING",
      );
    });

    it("bypasses image QC check when skip_image_qc is true on the job", async () => {
      const jobRow = makeJobRow({
        r2_asset_manifest: [
          {
            key: "/media/ch1/job1/audio_tts.wav",
            type: "audio/tts",
            size_bytes: 2048,
          },
          {
            key: "/media/ch1/job1/thumbnail.png",
            type: "image/thumbnail",
            size_bytes: 512,
          },
        ],
        skip_image_qc: true,
      });
      const template = makeTemplateRow({
        render_config: {
          engine: "FFMPEG",
          qc_image_review_required: true,
          settings: {},
        },
      });
      mockDb.limit
        .mockResolvedValueOnce([jobRow])
        .mockResolvedValueOnce([template]);

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
        qmsValidation: mockQmsValidationQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(runAutoImageQc).not.toHaveBeenCalled();
      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "QMS_VALIDATING",
      );
    });
  });

  // ─── Style-guide gate ─────────────────────────────────────────────────────

  describe("style-guide validation gate", () => {
    // NOTE: The style-guide gate in asset-collection.ts is temporarily disabled
    // (wrapped in /* ... */ at line ~397-444). Re-enable this test when the gate
    // is re-enabled in production.
    it.skip("fails with FAILED_QMS and returns early when archetype has no approved style_guide", async () => {
      const jobRow = makeJobRow();
      const template = makeTemplateRow({
        metadata: {
          archetype_id: "00000000-0000-0000-0000-000000000099",
          pipeline_config: {},
        },
      });

      // Three sequential limit() calls: job fetch, template fetch, style guide query.
      // The style guide query resolves to [] — rows[0] ?? null → null → fails gate.
      mockDb.limit
        .mockResolvedValueOnce([jobRow]) // 1st: job fetch
        .mockResolvedValueOnce([template]) // 2nd: template fetch
        .mockResolvedValueOnce([]); // 3rd: style guide query → no rows → null

      const processor = createAssetCollectionProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob({ job_id: JOB_ID });
      await processor(job as any);

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_QMS",
        expect.stringContaining("no approved style_guide"),
      );
    });
  });
});
