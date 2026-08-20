/**
 * Worker Factories Tests
 *
 * Tests for typed BullMQ Worker factory functions.
 * These create type-safe worker instances for different workload types.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Worker, Job } from "bullmq";
import type { Redis } from "ioredis";

// Mock BullMQ Worker class
const mockWorkerInstances: any[] = [];
vi.mock("bullmq", () => {
  class MockWorker {
    name: string;
    processor: any;
    options: any;
    mock = true;

    constructor(name: string, processor: any, options: any) {
      this.name = name;
      this.processor = processor;
      this.options = options;
      mockWorkerInstances.push(this);
    }
  }

  return {
    Worker: MockWorker,
  };
});

// Mock worker options getter
vi.mock("../../options/worker-options.js", () => ({
  getWorkerOptions: vi.fn((queueName: string) => ({
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  })),
}));

// Mock queue names
vi.mock("../../constants/queue-names.js", () => ({
  QUEUE_NAMES: {
    INGEST: "queue:ingest",
    AI_GENERATION: "queue:ai-generation",
    ASSET_COLLECTION: "queue:asset-collection",
    QMS_VALIDATION: "queue:qms-validation",
    RENDER_HEAVY: "queue:render-heavy",
    GARBAGE_COLLECTION: "queue:garbage-collection",
    SCENE_ANALYSIS: "queue:scene-analysis",
    DEAD_LETTER: "queue:dead-letter",
  },
}));

import { getWorkerOptions } from "../../options/worker-options.js";
import { QUEUE_NAMES } from "../../constants/queue-names.js";
import {
  createIngestWorker,
  createAIGenerationWorker,
  createAssetCollectionWorker,
  createQMSValidationWorker,
  createRenderHeavyWorker,
  createGarbageCollectionWorker,
  createSceneAnalysisWorker,
  createDeadLetterWorker,
  type Processor,
} from "../../factories/worker-factories.js";

describe("Worker Factories", () => {
  let mockConnection: Redis;
  let mockProcessor: Processor<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerInstances.length = 0;
    mockConnection = {} as Redis;
    mockProcessor = vi.fn().mockResolvedValue(undefined);
  });

  describe("createIngestWorker", () => {
    it("creates a Worker with correct name, processor, and connection", () => {
      const worker = createIngestWorker(mockConnection, mockProcessor);

      expect(worker).toBeDefined();
      expect(worker.name).toBe("queue:ingest");
      expect(worker.processor).toBe(mockProcessor);
      expect(worker.options.connection).toBe(mockConnection);
    });

    it("applies worker options from getWorkerOptions", () => {
      const worker = createIngestWorker(mockConnection, mockProcessor);

      expect(getWorkerOptions).toHaveBeenCalledWith("queue:ingest");
      expect(worker.options.concurrency).toBeDefined();
      expect(worker.options.limiter).toBeDefined();
    });
  });

  describe("createAIGenerationWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createAIGenerationWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:ai-generation");
      expect(worker.options.connection).toBe(mockConnection);
    });

    it("applies queue-specific options", () => {
      createAIGenerationWorker(mockConnection, mockProcessor);

      expect(getWorkerOptions).toHaveBeenCalledWith("queue:ai-generation");
    });
  });

  describe("createAssetCollectionWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createAssetCollectionWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:asset-collection");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("createQMSValidationWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createQMSValidationWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:qms-validation");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("createRenderHeavyWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createRenderHeavyWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:render-heavy");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("createGarbageCollectionWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createGarbageCollectionWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:garbage-collection");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("createSceneAnalysisWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createSceneAnalysisWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:scene-analysis");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("createDeadLetterWorker", () => {
    it("creates a Worker with correct name", () => {
      const worker = createDeadLetterWorker(mockConnection, mockProcessor);

      expect(worker.name).toBe("queue:dead-letter");
      expect(worker.options.connection).toBe(mockConnection);
    });
  });

  describe("all factories", () => {
    it("spread worker options into Worker constructor", () => {
      const factories = [
        createIngestWorker,
        createAIGenerationWorker,
        createAssetCollectionWorker,
        createQMSValidationWorker,
        createRenderHeavyWorker,
        createGarbageCollectionWorker,
        createSceneAnalysisWorker,
        createDeadLetterWorker,
      ];

      factories.forEach((factory) => {
        vi.clearAllMocks();
        const worker = factory(mockConnection, mockProcessor);

        expect(worker.options.connection).toBe(mockConnection);
        expect(worker.options.concurrency).toBeDefined();
        expect(worker.options.limiter).toBeDefined();
      });
    });

    it("pass processor function to Worker", () => {
      const factories = [
        createIngestWorker,
        createAIGenerationWorker,
        createAssetCollectionWorker,
        createQMSValidationWorker,
        createRenderHeavyWorker,
        createGarbageCollectionWorker,
        createSceneAnalysisWorker,
        createDeadLetterWorker,
      ];

      factories.forEach((factory) => {
        vi.clearAllMocks();
        const customProcessor = vi.fn();
        const worker = factory(mockConnection, customProcessor);

        expect(worker.processor).toBe(customProcessor);
      });
    });

    it("return worker instances", () => {
      const workers = [
        createIngestWorker(mockConnection, mockProcessor),
        createAIGenerationWorker(mockConnection, mockProcessor),
        createAssetCollectionWorker(mockConnection, mockProcessor),
        createQMSValidationWorker(mockConnection, mockProcessor),
        createRenderHeavyWorker(mockConnection, mockProcessor),
        createGarbageCollectionWorker(mockConnection, mockProcessor),
        createSceneAnalysisWorker(mockConnection, mockProcessor),
        createDeadLetterWorker(mockConnection, mockProcessor),
      ];

      workers.forEach((worker) => {
        expect(worker).toBeDefined();
        expect(worker).toHaveProperty("mock", true);
      });
    });
  });

  describe("processor type safety", () => {
    it("accepts correctly typed processor functions", () => {
      // This is primarily a TypeScript compile-time check
      // The test verifies the functions accept processor parameter
      const typedProcessor: Processor<{ job_id: string }> = async (job) => {
        // TypeScript should infer job.data as { job_id: string }
        const jobId = job.data.job_id;
      };

      const worker = createIngestWorker(mockConnection, typedProcessor);
      expect(worker).toBeDefined();
    });
  });
});
