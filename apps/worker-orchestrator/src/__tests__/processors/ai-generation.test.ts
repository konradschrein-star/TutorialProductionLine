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
  systemEvents: "systemEvents_table",
}));

vi.mock("@repo/db/repositories", () => ({
  getTTSVoiceByDatabaseId: vi.fn().mockResolvedValue({
    id: "test-voice-en",
    name: "Test Voice EN",
    provider: "AI33",
    voice_id: "test-voice-en",
    language: "en",
    is_active: true,
    is_default: true,
    settings: null,
    created_at: new Date("2026-04-01T00:00:00.000Z"),
    updated_at: new Date("2026-04-01T00:00:00.000Z"),
  }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _isSQLQuery: true,
    strings,
    values,
  })),
  relations: vi.fn(),
}));

vi.mock("@repo/domain", () => ({
  transitionJob: vi
    .fn()
    .mockReturnValue({ success: true, value: "ASSET_COLLECTION" }),
  sanitizePrompt: vi.fn((p: string) => p),
  simplifyPrompt: vi.fn((p: string) => p),
  buildReferenceInjectedPrompt: vi.fn((opts: { basePrompt: string }) => ({
    prompt: opts.basePrompt,
    referenceImages: [],
  })),
  runPreflightChecks: vi
    .fn()
    .mockReturnValue({ passed: true, score: 1, failures: [], warnings: [] }),
  createAPICallAuditLog: vi.fn().mockReturnValue({}),
  validateAPICallAuditLog: vi
    .fn()
    .mockReturnValue({ passed: true, score: 1, failures: [] }),
}));

vi.mock("@repo/config", () => ({
  loadConfig: vi.fn().mockReturnValue({
    AI33_API_KEY: "test-ai33-key",
    AI33_VOICE_EN: "test-voice-en",
    AI33_VOICE_DE: "test-voice-de",
    OLLAMA_URL: "http://localhost:11434",
    OLLAMA_MODEL: "gemma3:4b",
  }),
}));

vi.mock("@repo/contracts", () => ({
  AIGenerationPayloadSchema: {
    safeParse: vi
      .fn()
      .mockImplementation((data: unknown) => ({ success: true, data })),
  },
  buildErrorDetail: vi.fn((opts: Record<string, unknown>) => ({
    code: opts.code,
    message: opts.message,
    category: opts.category,
    retryable: opts.retryable,
    context: opts.context,
  })),
}));

// Mock the Anthropic client factory + generateScript (used only for the
// "gemini"/direct-anthropic script_provider branch; the default template
// below has no pipeline_config.script_provider, so it routes through
// llm-client's callLLM instead — see the mock below).
vi.mock("../../utils/anthropic-client.js", () => ({
  createAnthropicClient: vi.fn().mockReturnValue({
    /* opaque Anthropic instance */
  }),
  generateScript: vi.fn().mockResolvedValue({
    script: "Generated script content about the topic.",
    input_tokens: 100,
    output_tokens: 50,
  }),
}));

// Mock the LLM router. Script generation defaults to provider "claude_pool"
// (no pipeline_config.script_provider + no LLM_PROVIDER env), which routes
// through callLLM (dynamically imported inside handleScriptGeneration), not
// through anthropic-client's generateScript.
vi.mock("../../utils/llm-client.js", () => ({
  callLLM: vi
    .fn()
    .mockResolvedValue("Generated script content about the topic."),
}));

// Mock the AI33 client (TTS generation)
vi.mock("../../utils/ai33-client.js", () => ({
  generateTTS: vi.fn().mockResolvedValue(Buffer.from("fake-tts-audio")),
}));

// Mock the unified media gateway (image generation)
vi.mock("../../utils/media-gateway/index.js", () => ({
  requestImageBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
  toGatewayFormat: (raw: string | null | undefined) => raw ?? "OTHER",
}));

// Mock the R2 client
vi.mock("../../utils/r2-client.js", () => ({
  createR2Client: vi.fn().mockReturnValue(null),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from("fake-ref-image");
    },
  }),
  buildR2Key: vi.fn(
    (_channelId: string, jobId: string, filename: string) =>
      `/media/ch1/${jobId}/${filename}`,
  ),
}));

// Mock updateJobStatus so tests don't need a real state machine
vi.mock("../../utils/update-job-status.js", () => ({
  updateJobStatus: vi
    .fn()
    .mockResolvedValue({ id: "test-job-id", status: "FAILED_GENERAL" }),
}));

// Mock updateJobStatusAndDispatch (used by script handler for ASSET_COLLECTION transition)
vi.mock("../../utils/update-and-dispatch.js", () => ({
  updateJobStatusAndDispatch: vi.fn().mockResolvedValue({
    updatedJob: { id: "test-job-id", status: "ASSET_COLLECTION" },
    dispatchedTo: "queue:asset-collection",
  }),
}));

// Mock YouTube metadata service
vi.mock("../../youtube-metadata/index.js", () => ({
  generateMetadata: vi.fn().mockResolvedValue({
    metadata: {
      title: "Generated Title",
      description: "Generated description.",
      tags: ["tag1", "tag2"],
    },
    logEntry: {
      stage: "youtube_metadata",
      started_at: "2026-04-01T00:00:00.000Z",
      completed_at: "2026-04-01T00:00:01.000Z",
      duration_ms: 1000,
      model: "gemma3:4b",
      success: true,
    },
  }),
}));

// Mock the dynamic imports used inside handleTTSGeneration
vi.mock("../../utils/tts-provider.js", () => ({
  createTTSProvider: vi.fn().mockReturnValue({
    generateChunk: vi.fn().mockResolvedValue(Buffer.from("chunk-audio")),
  }),
}));

vi.mock("../../utils/ffmpeg-tts-splicing.js", () => ({
  addSilencePadding: vi.fn().mockResolvedValue(undefined),
  expertSpliceChunks: vi.fn().mockResolvedValue(undefined),
  probeAudioDuration: vi.fn().mockResolvedValue(120.5),
}));

vi.mock("../../utils/adaptive-rate-limiter.js", () => ({
  limitConcurrency: vi
    .fn()
    .mockImplementation(async (tasks: Array<() => Promise<unknown>>) =>
      tasks.map((t) => ({
        status: "fulfilled",
        value: "/tmp/tts-chunks-xxx/chunk_0_padded.mp3",
      })),
    ),
}));

vi.mock("../../utils/per-video-assets.js", () => ({
  loadReferenceImage: vi.fn().mockResolvedValue(null),
  assemblePerVideoAssets: vi.fn().mockResolvedValue({
    style_guide: undefined,
    characters: [],
    backgrounds: [],
  }),
}));

vi.mock("@repo/media-core", () => ({
  removeBackground: vi.fn().mockResolvedValue(Buffer.from("bg-removed-image")),
  runWhisper: vi.fn().mockResolvedValue([
    { word: "First", start: 0.0, end: 0.3 },
    { word: "paragraph", start: 0.3, end: 0.8 },
  ]),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createAIGenerationProcessor } from "../../processors/ai-generation.js";
import { generateScript } from "../../utils/anthropic-client.js";
import { callLLM } from "../../utils/llm-client.js";
import { requestImageBuffer } from "../../utils/media-gateway/index.js";
import { uploadToR2, buildR2Key } from "../../utils/r2-client.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobStatusAndDispatch } from "../../utils/update-and-dispatch.js";
import { generateMetadata } from "../../youtube-metadata/index.js";
import { AIGenerationPayloadSchema, buildErrorDetail } from "@repo/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "00000000-0000-0000-0000-000000000001";
const CHANNEL_ID = "00000000-0000-0000-0000-000000000002";
const TEMPLATE_ID = "00000000-0000-0000-0000-000000000010";

// ─── Payload factories ────────────────────────────────────────────────────────

function makeScriptPayload(overrides: Record<string, unknown> = {}) {
  return {
    generation_type: "script" as const,
    job_id: JOB_ID,
    template_id: TEMPLATE_ID,
    topic: "Quantum Computing",
    ...overrides,
  };
}

function makeTTSPayload(overrides: Record<string, unknown> = {}) {
  return {
    generation_type: "tts" as const,
    job_id: JOB_ID,
    voice_id: "test-voice-en",
    text: "First paragraph of the script.\n\nSecond paragraph of the script.",
    language: "en",
    ...overrides,
  };
}

function makeYouTubeMetadataPayload(overrides: Record<string, unknown> = {}) {
  return {
    generation_type: "youtube_metadata" as const,
    job_id: JOB_ID,
    topic: "Quantum Computing",
    format: "EXPLAINER",
    language: "en",
    ...overrides,
  };
}

function makeSentenceImagePayload(overrides: Record<string, unknown> = {}) {
  return {
    generation_type: "sentence_image" as const,
    job_id: JOB_ID,
    scene_index: 0,
    img_index: 0,
    group_index: 0,
    image_prompt: "A person explaining quantum computing on a whiteboard",
    enriched_image_prompt: null,
    aspect_ratio: "16:9",
    ...overrides,
  };
}

// ─── DB stub helpers ──────────────────────────────────────────────────────────

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return makeDbJob({
    channel_id: CHANNEL_ID,
    template_id: TEMPLATE_ID,
    ...overrides,
  });
}

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return makeDbTemplate({
    id: TEMPLATE_ID,
    prompts: { script: "Write a script about {{topic}}" },
    render_config: { engine: "FFMPEG", image_model: "seedream", settings: {} },
    ...overrides,
  });
}

// ─── Shared mock assembly manifest (for sentence_image tests) ─────────────────

function makeAssemblyManifestWithScene(scene_index = 0) {
  return {
    scenes: [
      {
        scene_index,
        visual_type: "BROLL",
        paragraph: "A sentence about quantum computing. Another sentence here.",
        sentence_images: [
          {
            sentence_text: "A sentence about quantum computing.",
            image_prompt:
              "A person explaining quantum computing on a whiteboard",
            enriched_image_prompt: null,
            is_key_fact: false,
            key_fact_text: null,
            group_index: 0,
            r2_key: null,
          },
        ],
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createAIGenerationProcessor", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockAiGenerationQueue: ReturnType<typeof makeMockQueue>;
  let mockAssetCollectionQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
    mockAiGenerationQueue = makeMockQueue();
    mockAssetCollectionQueue = makeMockQueue();

    // Restore the default pass-through for AIGenerationPayloadSchema
    vi.mocked(AIGenerationPayloadSchema.safeParse).mockImplementation(
      (data: unknown) => ({
        success: true,
        data: data as any,
      }),
    );
  });

  // ─── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("throws when AIGenerationPayloadSchema.safeParse fails", async () => {
      vi.mocked(AIGenerationPayloadSchema.safeParse).mockReturnValueOnce({
        success: false,
        error: { message: "Invalid generation_type", errors: [] } as any,
      });

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob({
        generation_type: "unknown_type",
        job_id: JOB_ID,
      });
      await expect(processor(job as any)).rejects.toThrow("Invalid payload");
    });
  });

  // ─── Script generation ───────────────────────────────────────────────────

  describe("generation_type: script", () => {
    beforeEach(() => {
      const template = makeTemplateRow();
      const jobRow = makeJobRow({ generation_log: [] });

      // Template fetch + job fetch for log
      mockDb.limit
        .mockResolvedValueOnce([template]) // template lookup
        .mockResolvedValue([jobRow]); // job fetch for existing generation_log
    });

    it("calls callLLM (claude_pool, the default script_provider) with the fully-substituted prompt", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await processor(job as any);

      expect(callLLM).toHaveBeenCalledWith(
        expect.any(String), // fully-substituted prompt
        expect.objectContaining({ provider: "claude_pool" }),
      );
    });

    it("saves the generated script to the database via db.update", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await processor(job as any);

      expect(mockDb.update).toHaveBeenCalled();
      const setArgs = mockDb.set.mock.calls.find(
        (args: any[]) => typeof args[0]?.script === "string",
      );
      expect(setArgs).toBeDefined();
      expect(setArgs![0].script).toBe(
        "Generated script content about the topic.",
      );
    });

    it("dispatches youtube-metadata generation to the ai-generation queue", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await processor(job as any);

      const metadataCalls = mockAiGenerationQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "youtube-metadata",
      );
      expect(metadataCalls).toHaveLength(1);
      expect(metadataCalls[0]![1]).toMatchObject({
        generation_type: "youtube_metadata",
        job_id: JOB_ID,
        topic: "Quantum Computing",
      });
    });

    it("calls updateJobStatusAndDispatch with ASSET_COLLECTION", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await processor(job as any);

      expect(updateJobStatusAndDispatch).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "ASSET_COLLECTION",
        expect.objectContaining({ aiGeneration: mockAiGenerationQueue }),
      );
    });

    it("throws when template is not found", async () => {
      // Clear the queued once-mocks from beforeEach and return empty for all calls
      mockDb.limit.mockReset().mockResolvedValue([]);

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await expect(processor(job as any)).rejects.toThrow(
        `Template ${TEMPLATE_ID} not found`,
      );
    });

    it("throws when template has no script prompt", async () => {
      // Reset and re-queue only the empty-prompts template (no other queued mocks)
      mockDb.limit.mockReset();
      const template = makeTemplateRow({ prompts: {} }); // no script prompt
      mockDb.limit.mockResolvedValueOnce([template]).mockResolvedValue([]);

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await expect(processor(job as any)).rejects.toThrow(
        `No script prompt found in template ${TEMPLATE_ID}`,
      );
    });

    it("calls updateJobStatus with FAILED_GENERAL when callLLM throws", async () => {
      const template = makeTemplateRow();
      mockDb.limit.mockResolvedValueOnce([template]);

      vi.mocked(callLLM).mockRejectedValueOnce(
        new Error("Claude pool API down"),
      );

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeScriptPayload());
      await expect(processor(job as any)).rejects.toThrow(
        "Claude pool API down",
      );

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        "Claude pool API down",
        expect.objectContaining({ code: "SCRIPT_GENERATION_FAILED" }),
      );
    });
  });

  // ─── TTS generation ──────────────────────────────────────────────────────

  describe("generation_type: tts", () => {
    beforeEach(() => {
      const jobRow = makeJobRow();
      mockDb.limit.mockResolvedValue([jobRow]);

      // fs/path/os dynamic imports — mock at module level via node:fs etc.
      // The TTS handler does dynamic imports of tts-provider, ffmpeg-tts-splicing,
      // adaptive-rate-limiter, all of which are already mocked above.
    });

    it("calls uploadToR2 with the spliced audio buffer", async () => {
      // We need fs.promises.mkdtemp, readFile, rm to work in tests.
      // Stub them at the module level via vi.stubGlobal approach is complex,
      // so instead we spy on the dynamic import chain through the mocks already set.
      // The test validates that after the pipeline runs, uploadToR2 was called.

      // To make fs.promises work in tests without real filesystem access,
      // mock the entire node:fs/promises module for the duration of this test suite.
      const fsMock = {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/tts-chunks-test"),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi
          .fn()
          .mockResolvedValue(Buffer.from("spliced-audio-content")),
        rm: vi.fn().mockResolvedValue(undefined),
      };
      vi.doMock("fs", () => ({ promises: fsMock }));

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeTTSPayload());

      // The TTS handler does dynamic imports; since they're all mocked at the
      // top of this file, uploadToR2 should be called when the pipeline runs.
      // If the test hangs on real fs calls, the dynamic import mocks handle it.
      await processor(job as any);

      expect(uploadToR2).toHaveBeenCalledWith(
        null, // r2Client (returns null from createR2Client)
        "",
        expect.stringContaining("audio_tts.wav"),
        expect.any(Buffer),
        "audio/wav",
      );
    });

    it("re-triggers asset collection queue after TTS completion", async () => {
      const fsMock = {
        mkdtemp: vi.fn().mockResolvedValue("/tmp/tts-chunks-test"),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi
          .fn()
          .mockResolvedValue(Buffer.from("spliced-audio-content")),
        rm: vi.fn().mockResolvedValue(undefined),
      };
      vi.doMock("fs", () => ({ promises: fsMock }));

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeTTSPayload());
      await processor(job as any);

      const assetCollectCalls = mockAssetCollectionQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "collect-assets",
      );
      expect(assetCollectCalls).toHaveLength(1);
      expect(assetCollectCalls[0]![1]).toMatchObject({ job_id: JOB_ID });
    });

    it("calls updateJobStatus with FAILED_GENERAL when job is not found", async () => {
      mockDb.limit.mockResolvedValue([]); // no job found

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeTTSPayload());
      await expect(processor(job as any)).rejects.toThrow(
        `Job ${JOB_ID} not found`,
      );

      expect(updateJobStatus).toHaveBeenCalledWith(
        mockDb,
        JOB_ID,
        "FAILED_GENERAL",
        `Job ${JOB_ID} not found`,
        expect.objectContaining({ code: "TTS_GENERATION_FAILED" }),
      );
    });
  });

  // ─── YouTube metadata generation ─────────────────────────────────────────

  describe("generation_type: youtube_metadata", () => {
    beforeEach(() => {
      const jobRow = makeJobRow({
        script: "A long script about quantum computing. ".repeat(5),
        generation_log: [],
      });
      mockDb.limit.mockResolvedValue([jobRow]);
    });

    it("calls generateMetadata with the script and topic", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await processor(job as any);

      expect(generateMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          script: expect.stringContaining("quantum computing"),
          topic: "Quantum Computing",
          format: "EXPLAINER",
          language: "en",
        }),
        expect.objectContaining({
          url: "http://localhost:11434",
          model: "gemma3:4b",
        }),
      );
    });

    it("updates title, description, and tags when generateMetadata succeeds", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await processor(job as any);

      const setArgs = mockDb.set.mock.calls.find(
        (args: any[]) => typeof args[0]?.title === "string",
      );
      expect(setArgs).toBeDefined();
      expect(setArgs![0].title).toBe("Generated Title");
      expect(setArgs![0].description).toBe("Generated description.");
      expect(setArgs![0].generated_tags).toEqual(["tag1", "tag2"]);
    });

    it("does NOT change job status (enrichment-only operation)", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await processor(job as any);

      expect(updateJobStatus).not.toHaveBeenCalled();
      expect(updateJobStatusAndDispatch).not.toHaveBeenCalled();
    });

    it("still appends generation_log entry even when metadata is null (failure case)", async () => {
      vi.mocked(generateMetadata).mockResolvedValueOnce({
        metadata: null,
        logEntry: {
          stage: "youtube_metadata",
          started_at: "2026-04-01T00:00:00.000Z",
          completed_at: "2026-04-01T00:00:01.000Z",
          duration_ms: 1000,
          model: "gemma3:4b",
          success: false,
          error: "Gemma parse error",
        } as any,
      });

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await processor(job as any);

      const setArgs = mockDb.set.mock.calls.find((args: any[]) =>
        Array.isArray(args[0]?.generation_log),
      );
      expect(setArgs).toBeDefined();
      // Should NOT update title/description on failure
      expect(setArgs![0].title).toBeUndefined();
    });

    it("returns early without calling DB when job is not found", async () => {
      mockDb.limit.mockResolvedValue([]);

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await expect(processor(job as any)).resolves.toBeUndefined();

      expect(generateMetadata).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("returns early without calling generateMetadata when script is too short", async () => {
      const jobRow = makeJobRow({ script: "Too short.", generation_log: [] });
      mockDb.limit.mockResolvedValue([jobRow]);

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
      });

      const job = makeBullmqJob(makeYouTubeMetadataPayload());
      await expect(processor(job as any)).resolves.toBeUndefined();

      expect(generateMetadata).not.toHaveBeenCalled();
    });
  });

  // ─── Sentence image generation ────────────────────────────────────────────

  describe("generation_type: sentence_image", () => {
    const assemblyManifest = makeAssemblyManifestWithScene(0);

    beforeEach(() => {
      const template = makeTemplateRow({
        render_config: {
          engine: "FFMPEG",
          image_model: "seedream",
          settings: {},
        },
      });
      const jobRow = makeJobRow({ assembly_manifest: assemblyManifest });

      mockDb.limit
        .mockResolvedValueOnce([jobRow]) // job fetch
        .mockResolvedValueOnce([template]); // template fetch

      // transaction: SELECT FOR UPDATE returns a row with assembly_manifest
      mockDb.transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txMock = {
          ...mockDb,
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([{ assembly_manifest: assemblyManifest }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
        };
        return fn(txMock);
      });
    });

    it("requests the sentence image through the media gateway", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeSentenceImagePayload());
      await processor(job as any);

      expect(requestImageBuffer).toHaveBeenCalledWith(
        expect.stringContaining("whiteboard"),
        expect.objectContaining({ aspectRatio: "16:9" }),
      );
    });

    it("calls uploadToR2 after successful image generation", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeSentenceImagePayload());
      await processor(job as any);

      expect(uploadToR2).toHaveBeenCalledWith(
        null,
        "",
        expect.stringContaining("scene_0_img_0.png"),
        expect.any(Buffer),
        "image/png",
      );
    });

    it("re-triggers asset collection after image upload", async () => {
      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeSentenceImagePayload());
      await processor(job as any);

      const collectCalls = mockAssetCollectionQueue.add.mock.calls.filter(
        (args: any[]) => args[0] === "collect-assets",
      );
      expect(collectCalls).toHaveLength(1);
      expect(collectCalls[0]![1]).toMatchObject({ job_id: JOB_ID });
    });

    it("does NOT throw (returns early) when the media gateway fails", async () => {
      vi.mocked(requestImageBuffer).mockRejectedValue(
        new Error("Content policy violation"),
      );

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeSentenceImagePayload());
      // sentence_image failures are non-fatal by design — should not throw
      await expect(processor(job as any)).resolves.toBeUndefined();
      expect(uploadToR2).not.toHaveBeenCalled();
    });

    it("schedules a retry (does not throw) on a rate-limit error from the gateway", async () => {
      vi.mocked(requestImageBuffer).mockRejectedValue(
        new Error("429 Too Many Requests — rate limit"),
      );

      const processor = createAIGenerationProcessor(mockDb, {
        aiGeneration: mockAiGenerationQueue as any,
        assetCollection: mockAssetCollectionQueue as any,
      });

      const job = makeBullmqJob(makeSentenceImagePayload());
      // Temporary errors are handled via scheduleImageRetry, not rethrown.
      await expect(processor(job as any)).resolves.toBeUndefined();
    });
  });
});
