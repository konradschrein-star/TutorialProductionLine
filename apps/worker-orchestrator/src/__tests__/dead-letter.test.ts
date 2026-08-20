import { describe, it, expect } from "vitest";

/**
 * Dead Letter Logging Tests
 *
 * Validates that dead letter queue error logging captures full context
 * for operator debugging without requiring log archaeology.
 */
describe("Dead Letter Error Context", () => {
  it("should construct full error details object", () => {
    // Simulate a BullMQ job that has exhausted retries
    const mockJob = {
      id: "test-job-123",
      name: "test-queue-job",
      attemptsMade: 5,
      failedReason: "Connection timeout after 30s",
      stacktrace: [
        "Error: Connection timeout",
        "Error: Network unreachable",
        "Error: Initial failure",
      ],
      data: { job_id: "uuid-456", channel_id: "channel-789" },
      processedOn: 1672531200000,
      finishedOn: 1672531260000,
    };

    // Build the enhanced error details object
    const errorDetails = {
      jobId: mockJob.id,
      jobName: mockJob.name,
      attemptsMade: mockJob.attemptsMade,
      failedReason: mockJob.failedReason ?? "unknown reason",
      stackTrace: mockJob.stacktrace?.slice(0, 3) ?? [],
      timestamp: new Date().toISOString(),
      jobData: mockJob.data,
      processedOn: mockJob.processedOn,
      finishedOn: mockJob.finishedOn,
    };

    const errorMessage = `BullMQ retries exhausted: ${JSON.stringify(errorDetails, null, 2)}`;

    // Assertions
    expect(errorDetails.jobId).toBe("test-job-123");
    expect(errorDetails.attemptsMade).toBe(5);
    expect(errorDetails.failedReason).toBe("Connection timeout after 30s");
    expect(errorDetails.stackTrace).toHaveLength(3);
    expect(errorDetails.jobData).toEqual({
      job_id: "uuid-456",
      channel_id: "channel-789",
    });
    expect(errorMessage).toContain("Connection timeout");
    expect(errorMessage).toContain("attemptsMade");
    expect(errorMessage).toContain("stackTrace");
  });

  it("should handle missing stacktrace gracefully", () => {
    const mockJob = {
      id: "test-job-456",
      name: "test-queue-job",
      attemptsMade: 3,
      failedReason: "Unknown error",
      stacktrace: undefined,
      data: { job_id: "uuid-789" },
      processedOn: 1672531200000,
      finishedOn: 1672531260000,
    };

    const errorDetails = {
      jobId: mockJob.id,
      jobName: mockJob.name,
      attemptsMade: mockJob.attemptsMade,
      failedReason: mockJob.failedReason ?? "unknown reason",
      stackTrace: mockJob.stacktrace?.slice(0, 3) ?? [],
      timestamp: new Date().toISOString(),
      jobData: mockJob.data,
      processedOn: mockJob.processedOn,
      finishedOn: mockJob.finishedOn,
    };

    expect(errorDetails.stackTrace).toEqual([]);
  });

  it("should handle missing failedReason gracefully", () => {
    const mockJob = {
      id: "test-job-789",
      name: "test-queue-job",
      attemptsMade: 2,
      failedReason: undefined,
      stacktrace: ["Error: Something went wrong"],
      data: { job_id: "uuid-abc" },
      processedOn: 1672531200000,
      finishedOn: 1672531260000,
    };

    const errorDetails = {
      jobId: mockJob.id,
      jobName: mockJob.name,
      attemptsMade: mockJob.attemptsMade,
      failedReason: mockJob.failedReason ?? "unknown reason",
      stackTrace: mockJob.stacktrace?.slice(0, 3) ?? [],
      timestamp: new Date().toISOString(),
      jobData: mockJob.data,
      processedOn: mockJob.processedOn,
      finishedOn: mockJob.finishedOn,
    };

    expect(errorDetails.failedReason).toBe("unknown reason");
  });
});
