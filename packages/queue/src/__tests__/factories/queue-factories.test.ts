/**
 * Queue Factories Tests
 *
 * Tests for typed BullMQ Queue factory functions.
 * These create type-safe queue instances for different workload types.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

// Mock BullMQ Queue class
const mockQueueInstances: any[] = [];
vi.mock("bullmq", () => {
  class MockQueue {
    name: string;
    options: any;
    mock = true;

    constructor(name: string, options: any) {
      this.name = name;
      this.options = options;
      mockQueueInstances.push(this);
    }
  }

  return {
    Queue: MockQueue,
  };
});

// Mock queue options getter
vi.mock("../../options/queue-options.js", () => ({
  getQueueOptions: vi.fn((queueName: string) => ({
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
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

import { getQueueOptions } from "../../options/queue-options.js";
import { QUEUE_NAMES } from "../../constants/queue-names.js";
import {
  createIngestQueue,
  createAIGenerationQueue,
  createAssetCollectionQueue,
  createQMSValidationQueue,
  createRenderHeavyQueue,
  createGarbageCollectionQueue,
  createSceneAnalysisQueue,
  createDeadLetterQueue,
} from "../../factories/queue-factories.js";

describe("Queue Factories", () => {
  let mockConnection: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueInstances.length = 0;
    mockConnection = {} as Redis;
  });

  describe("createIngestQueue", () => {
    it("creates a Queue with correct name and connection", () => {
      const queue = createIngestQueue(mockConnection);

      expect(queue).toBeDefined();
      expect(queue.name).toBe("queue:ingest");
      expect(queue.options.connection).toBe(mockConnection);
    });

    it("applies queue options from getQueueOptions", () => {
      const queue = createIngestQueue(mockConnection);

      expect(getQueueOptions).toHaveBeenCalledWith("queue:ingest");
      expect(queue.options.defaultJobOptions).toBeDefined();
    });
  });

  describe("createAIGenerationQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createAIGenerationQueue(mockConnection);

      expect(queue.name).toBe("queue:ai-generation");
      expect(queue.options.connection).toBe(mockConnection);
    });

    it("applies queue-specific options", () => {
      createAIGenerationQueue(mockConnection);

      expect(getQueueOptions).toHaveBeenCalledWith("queue:ai-generation");
    });
  });

  describe("createAssetCollectionQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createAssetCollectionQueue(mockConnection);

      expect(queue.name).toBe("queue:asset-collection");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("createQMSValidationQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createQMSValidationQueue(mockConnection);

      expect(queue.name).toBe("queue:qms-validation");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("createRenderHeavyQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createRenderHeavyQueue(mockConnection);

      expect(queue.name).toBe("queue:render-heavy");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("createGarbageCollectionQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createGarbageCollectionQueue(mockConnection);

      expect(queue.name).toBe("queue:garbage-collection");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("createSceneAnalysisQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createSceneAnalysisQueue(mockConnection);

      expect(queue.name).toBe("queue:scene-analysis");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("createDeadLetterQueue", () => {
    it("creates a Queue with correct name", () => {
      const queue = createDeadLetterQueue(mockConnection);

      expect(queue.name).toBe("queue:dead-letter");
      expect(queue.options.connection).toBe(mockConnection);
    });
  });

  describe("all factories", () => {
    it("spread queue options into Queue constructor", () => {
      const factories = [
        createIngestQueue,
        createAIGenerationQueue,
        createAssetCollectionQueue,
        createQMSValidationQueue,
        createRenderHeavyQueue,
        createGarbageCollectionQueue,
        createSceneAnalysisQueue,
        createDeadLetterQueue,
      ];

      factories.forEach((factory) => {
        vi.clearAllMocks();
        const queue = factory(mockConnection);

        expect(queue.options.connection).toBe(mockConnection);
        expect(queue.options.defaultJobOptions).toBeDefined();
      });
    });

    it("return queue instances", () => {
      const queues = [
        createIngestQueue(mockConnection),
        createAIGenerationQueue(mockConnection),
        createAssetCollectionQueue(mockConnection),
        createQMSValidationQueue(mockConnection),
        createRenderHeavyQueue(mockConnection),
        createGarbageCollectionQueue(mockConnection),
        createSceneAnalysisQueue(mockConnection),
        createDeadLetterQueue(mockConnection),
      ];

      queues.forEach((queue) => {
        expect(queue).toBeDefined();
        expect(queue).toHaveProperty("mock", true);
      });
    });
  });
});
