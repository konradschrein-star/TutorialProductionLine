/**
 * Redis Connection Tests
 *
 * Tests for Redis connection factory functions.
 * These create IORedis connections configured for BullMQ.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "ioredis";

// Mock IORedis
const mockQuit = vi.fn().mockResolvedValue("OK");

vi.mock("ioredis", () => {
  class MockIoRedis {
    quit = mockQuit;
    status = "ready";

    constructor(url: string, options: any) {
      // Store constructor args for test verification
      (this as any).url = url;
      (this as any).options = options;
    }
  }

  return { default: MockIoRedis };
});

import IoRedis from "ioredis";
import { createRedisConnection, closeRedisConnection } from "../connection.js";

describe("createRedisConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("string URL format", () => {
    it("creates connection from string URL", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;

      expect(connection).toBeDefined();
      expect(connection.url).toBe("redis://localhost:6379");
      expect(connection.options.maxRetriesPerRequest).toBe(null);
      expect(connection.options.enableReadyCheck).toBe(false);
    });

    it("creates connection from string with password", () => {
      const connection = createRedisConnection("redis://:mypassword@localhost:6379") as any;

      expect(connection.url).toBe("redis://:mypassword@localhost:6379");
      expect(connection.options).toBeDefined();
    });

    it("creates connection from string with database number", () => {
      const connection = createRedisConnection("redis://localhost:6379/2") as any;

      expect(connection.url).toBe("redis://localhost:6379/2");
      expect(connection.options).toBeDefined();
    });
  });

  describe("options object format", () => {
    it("creates connection from options object", () => {
      const connection = createRedisConnection({
        url: "redis://localhost:6379",
      }) as any;

      expect(connection).toBeDefined();
      expect(connection.url).toBe("redis://localhost:6379");
      expect(connection.options.maxRetriesPerRequest).toBe(null);
      expect(connection.options.enableReadyCheck).toBe(false);
    });

    it("uses queue mode defaults", () => {
      const connection = createRedisConnection({
        url: "redis://localhost:6379",
        mode: "queue",
      }) as any;

      expect(connection.options.maxRetriesPerRequest).toBe(null);
      expect(connection.options.enableReadyCheck).toBe(false);
    });

    it("uses worker mode defaults", () => {
      const connection = createRedisConnection({
        url: "redis://localhost:6379",
        mode: "worker",
      }) as any;

      expect(connection.options.maxRetriesPerRequest).toBe(null);
      expect(connection.options.enableReadyCheck).toBe(false);
    });

    it("allows custom maxRetriesPerRequest", () => {
      const connection = createRedisConnection({
        url: "redis://localhost:6379",
        maxRetriesPerRequest: 5,
      }) as any;

      expect(connection.options.maxRetriesPerRequest).toBe(5);
    });

    it("allows custom enableReadyCheck", () => {
      const connection = createRedisConnection({
        url: "redis://localhost:6379",
        enableReadyCheck: true,
      }) as any;

      expect(connection.options.enableReadyCheck).toBe(true);
    });
  });

  describe("retry strategy", () => {
    it("includes retry strategy function", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;

      expect(connection.options.retryStrategy).toBeInstanceOf(Function);
    });

    it("retry strategy returns exponential backoff with max", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;
      const retryStrategy = connection.options.retryStrategy;

      // Test exponential backoff
      expect(retryStrategy(1)).toBe(50); // 1 * 50
      expect(retryStrategy(10)).toBe(500); // 10 * 50
      expect(retryStrategy(40)).toBe(2000); // Math.min(40 * 50, 2000)
      expect(retryStrategy(100)).toBe(2000); // Capped at 2000
    });
  });

  describe("reconnect on error strategy", () => {
    it("includes reconnectOnError function", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;

      expect(connection.options.reconnectOnError).toBeInstanceOf(Function);
    });

    it("reconnects on READONLY error", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;
      const reconnectOnError = connection.options.reconnectOnError;

      const error = new Error("READONLY: You can't write against a read only replica");
      expect(reconnectOnError(error)).toBe(true);
    });

    it("reconnects on ECONNREFUSED error", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;
      const reconnectOnError = connection.options.reconnectOnError;

      const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");
      expect(reconnectOnError(error)).toBe(true);
    });

    it("reconnects on ETIMEDOUT error", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;
      const reconnectOnError = connection.options.reconnectOnError;

      const error = new Error("Connection timeout ETIMEDOUT");
      expect(reconnectOnError(error)).toBe(true);
    });

    it("does not reconnect on other errors", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;
      const reconnectOnError = connection.options.reconnectOnError;

      const error = new Error("WRONGPASS invalid username-password pair");
      expect(reconnectOnError(error)).toBe(false);
    });
  });

  describe("BullMQ compatibility", () => {
    it("sets maxRetriesPerRequest to null for BullMQ compatibility", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;

      expect(connection.options.maxRetriesPerRequest).toBe(null);
    });

    it("disables enableReadyCheck for faster worker startup", () => {
      const connection = createRedisConnection("redis://localhost:6379") as any;

      expect(connection.options.enableReadyCheck).toBe(false);
    });
  });
});

describe("closeRedisConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls quit on the connection", async () => {
    const connection = createRedisConnection("redis://localhost:6379") as unknown as Redis;

    await closeRedisConnection(connection);

    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it("waits for quit to complete", async () => {
    const connection = createRedisConnection("redis://localhost:6379") as unknown as Redis;

    const result = await closeRedisConnection(connection);

    expect(result).toBeUndefined();
    expect(mockQuit).toHaveBeenCalled();
  });
});
