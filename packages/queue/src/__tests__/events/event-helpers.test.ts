/**
 * Event Helpers Tests
 *
 * Tests for BullMQ worker event listener attachments.
 * These provide structured logging for observability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Worker, Job } from "bullmq";
import {
  attachStandardEventListeners,
  attachProgressEventListener,
  attachAllEventListeners,
} from "../../events/event-helpers.js";

describe("Event Helpers", () => {
  let mockWorker: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let eventHandlers: Record<string, Function>;

  beforeEach(() => {
    // Reset event handlers map
    eventHandlers = {};

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock worker with event listener tracking
    mockWorker = {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      }),
    } as unknown as Worker<any>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("attachStandardEventListeners", () => {
    it("attaches completed event listener", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith(
        "completed",
        expect.any(Function),
      );
      expect(eventHandlers.completed).toBeDefined();
    });

    it("attaches failed event listener", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith(
        "failed",
        expect.any(Function),
      );
      expect(eventHandlers.failed).toBeDefined();
    });

    it("attaches stalled event listener", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith(
        "stalled",
        expect.any(Function),
      );
      expect(eventHandlers.stalled).toBeDefined();
    });

    it("attaches error event listener", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(eventHandlers.error).toBeDefined();
    });

    it("attaches active event listener", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith(
        "active",
        expect.any(Function),
      );
      expect(eventHandlers.active).toBeDefined();
    });

    it("attaches all standard listeners (5 total)", () => {
      attachStandardEventListeners(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledTimes(5);
    });

    describe("completed handler", () => {
      it("logs structured completion event with all job details", () => {
        attachStandardEventListeners(mockWorker, "IngestWorker");

        const mockJob = {
          id: "job-123",
          name: "process-video",
          queueName: "queue:ingest",
          processedOn: 1000,
          finishedOn: 5000,
        } as unknown as Job<any>;

        eventHandlers.completed(mockJob);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logOutput).toMatchObject({
          event: "job_completed",
          status: "completed",
          worker: "IngestWorker",
          jobId: "job-123",
          jobName: "process-video",
          queueName: "queue:ingest",
          duration: 4000, // 5000 - 1000
        });
        expect(logOutput.timestamp).toBeDefined();
      });

      it("calculates duration when processedOn is missing", () => {
        attachStandardEventListeners(mockWorker, "TestWorker");

        const mockJob = {
          id: "job-456",
          name: "test",
          queueName: "test-queue",
          processedOn: undefined,
          finishedOn: 5000,
        } as unknown as Job<any>;

        eventHandlers.completed(mockJob);

        const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logOutput.duration).toBe(0); // finishedOn - finishedOn = 0
      });

      it("calculates duration as 0 when finishedOn is missing", () => {
        attachStandardEventListeners(mockWorker, "TestWorker");

        const mockJob = {
          id: "job-789",
          name: "test",
          queueName: "test-queue",
          processedOn: 1000,
          finishedOn: undefined,
        } as unknown as Job<any>;

        eventHandlers.completed(mockJob);

        const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logOutput.duration).toBe(0);
      });
    });

    describe("failed handler", () => {
      it("logs structured failure event with job and error details", () => {
        attachStandardEventListeners(mockWorker, "RenderWorker");

        const mockJob = {
          id: "job-fail-1",
          name: "render-video",
          queueName: "queue:render-heavy",
          attemptsMade: 3,
        } as unknown as Job<any>;

        const error = new Error("FFmpeg process exited with code 1");
        error.stack = "Error: FFmpeg...\n  at render()";

        eventHandlers.failed(mockJob, error);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(logOutput).toMatchObject({
          event: "job_failed",
          status: "failed",
          worker: "RenderWorker",
          jobId: "job-fail-1",
          jobName: "render-video",
          queueName: "queue:render-heavy",
          failureReason: "FFmpeg process exited with code 1",
          error: "FFmpeg process exited with code 1",
          attemptsMade: 3,
        });
        expect(logOutput.stack).toContain("FFmpeg");
        expect(logOutput.timestamp).toBeDefined();
      });

      it("handles failed event with undefined job", () => {
        attachStandardEventListeners(mockWorker, "TestWorker");

        const error = new Error("Unknown failure");

        eventHandlers.failed(undefined, error);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(logOutput.event).toBe("job_failed");
        expect(logOutput.worker).toBe("TestWorker");
        expect(logOutput.error).toBe("Unknown failure");
        // jobId, jobName, queueName, attemptsMade will be undefined
        // but JSON.stringify omits undefined values, so they won't be in output
      });
    });

    describe("stalled handler", () => {
      it("logs structured stalled event with jobId", () => {
        attachStandardEventListeners(mockWorker, "OrchestratorWorker");

        eventHandlers.stalled("job-stalled-123");

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
        expect(logOutput).toMatchObject({
          event: "job_stalled",
          worker: "OrchestratorWorker",
          jobId: "job-stalled-123",
        });
        expect(logOutput.timestamp).toBeDefined();
      });
    });

    describe("error handler", () => {
      it("logs structured worker error event", () => {
        attachStandardEventListeners(mockWorker, "AIWorker");

        const error = new Error("Redis connection lost");
        error.stack = "Error: Redis...\n  at connect()";

        eventHandlers.error(error);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(logOutput).toMatchObject({
          event: "worker_error",
          worker: "AIWorker",
          error: "Redis connection lost",
        });
        expect(logOutput.stack).toContain("Redis");
        expect(logOutput.timestamp).toBeDefined();
      });
    });

    describe("active handler", () => {
      it("logs structured active event when job starts processing", () => {
        attachStandardEventListeners(mockWorker, "ValidationWorker");

        const mockJob = {
          id: "job-active-1",
          name: "validate-payload",
          queueName: "queue:qms-validation",
        } as unknown as Job<any>;

        eventHandlers.active(mockJob);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logOutput).toMatchObject({
          event: "job_active",
          worker: "ValidationWorker",
          jobId: "job-active-1",
          jobName: "validate-payload",
          queueName: "queue:qms-validation",
        });
        expect(logOutput.timestamp).toBeDefined();
      });
    });
  });

  describe("attachProgressEventListener", () => {
    it("attaches progress event listener", () => {
      attachProgressEventListener(mockWorker, "TestWorker");

      expect(mockWorker.on).toHaveBeenCalledWith(
        "progress",
        expect.any(Function),
      );
      expect(eventHandlers.progress).toBeDefined();
    });

    it("logs structured progress event with job and progress data", () => {
      attachProgressEventListener(mockWorker, "RenderWorker");

      const mockJob = {
        id: "job-progress-1",
        name: "render-video",
      } as unknown as Job<any>;

      const progress = {
        percent: 45,
        stage: "encoding",
      };

      eventHandlers.progress(mockJob, progress);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput).toMatchObject({
        event: "job_progress",
        worker: "RenderWorker",
        jobId: "job-progress-1",
        jobName: "render-video",
        progress: {
          percent: 45,
          stage: "encoding",
        },
      });
      expect(logOutput.timestamp).toBeDefined();
    });

    it("handles numeric progress values", () => {
      attachProgressEventListener(mockWorker, "TestWorker");

      const mockJob = {
        id: "job-1",
        name: "test",
      } as unknown as Job<any>;

      eventHandlers.progress(mockJob, 75);

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.progress).toBe(75);
    });

    it("handles object progress values", () => {
      attachProgressEventListener(mockWorker, "TestWorker");

      const mockJob = {
        id: "job-1",
        name: "test",
      } as unknown as Job<any>;

      const complexProgress = {
        current: 50,
        total: 100,
        eta: 120,
        message: "Processing frames",
      };

      eventHandlers.progress(mockJob, complexProgress);

      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.progress).toEqual(complexProgress);
    });
  });

  describe("attachAllEventListeners", () => {
    it("attaches both standard and progress listeners", () => {
      attachAllEventListeners(mockWorker, "CompleteWorker");

      // 5 standard + 1 progress = 6 total
      expect(mockWorker.on).toHaveBeenCalledTimes(6);
      expect(eventHandlers.completed).toBeDefined();
      expect(eventHandlers.failed).toBeDefined();
      expect(eventHandlers.stalled).toBeDefined();
      expect(eventHandlers.error).toBeDefined();
      expect(eventHandlers.active).toBeDefined();
      expect(eventHandlers.progress).toBeDefined();
    });

    it("logs both standard and progress events", () => {
      attachAllEventListeners(mockWorker, "FullWorker");

      // Trigger completed event
      const mockJob = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        finishedOn: 1000,
      } as unknown as Job<any>;

      eventHandlers.completed(mockJob);
      expect(consoleLogSpy).toHaveBeenCalled();

      // Trigger progress event
      eventHandlers.progress(mockJob, 50);
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("worker name handling", () => {
    it("uses custom worker names in logs", () => {
      const workerNames = [
        "IngestWorker",
        "AIGenerationWorker",
        "RenderWorker",
        "ValidationWorker",
        "GarbageCollectionWorker",
      ];

      workerNames.forEach((workerName) => {
        vi.clearAllMocks();
        eventHandlers = {};

        const mockWorker = {
          on: vi.fn((event: string, handler: Function) => {
            eventHandlers[event] = handler;
          }),
        } as unknown as Worker<any>;

        attachStandardEventListeners(mockWorker, workerName);

        const mockJob = {
          id: "job-1",
          name: "test",
          queueName: "test",
          finishedOn: 1000,
        } as unknown as Job<any>;

        eventHandlers.completed(mockJob);

        const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(logOutput.worker).toBe(workerName);
      });
    });
  });
});
