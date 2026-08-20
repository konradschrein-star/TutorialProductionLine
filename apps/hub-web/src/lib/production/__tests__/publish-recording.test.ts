import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The invariant these tests exist for:
 *
 *   A resumed / retried / duplicated recording upload must never enqueue a
 *   second splice job for the same take — but a genuine RE-take must always
 *   get one, even though BullMQ keeps the previous completed job under the
 *   same deterministic id for 24h (tutorialSpliceQueueOptions).
 */

const updateTutorialJob = vi.fn(async () => undefined);
const listTutorialJobsByParent = vi.fn(async () => []);
const statMock = vi.fn();

const queueAdd = vi.fn(async () => undefined);
const queueGetJob = vi.fn();
const connQuit = vi.fn(async () => undefined);

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => statMock(...args),
}));

vi.mock("@repo/db", () => ({
  updateTutorialJob: (...args: unknown[]) => updateTutorialJob(...args),
  listTutorialJobsByParent: (...args: unknown[]) =>
    listTutorialJobsByParent(...args),
}));

vi.mock("@repo/queue", () => ({
  createRedisConnection: () => ({ quit: connQuit }),
  createTutorialSpliceQueue: () => ({
    add: (...args: unknown[]) => queueAdd(...args),
    getJob: (...args: unknown[]) => queueGetJob(...args),
  }),
}));

vi.mock("../create-stitch-job", () => ({
  createStitchJobForTutorial: vi.fn(async () => ({ ok: true })),
}));

import { publishRecording } from "../publish-recording";

const job = {
  id: "job-1",
  mode: "SINGLE",
  parent_job_id: null,
  recording_path: null,
} as never;

const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env["REDIS_URL"] = "redis://localhost:6379";
  statMock.mockResolvedValue({ isFile: () => true, size: 12345 });
  queueGetJob.mockResolvedValue(null);
});

describe("publishRecording", () => {
  it("publishes recording_path and enqueues a splice under a deterministic id", async () => {
    const res = await publishRecording(
      db,
      job,
      "/media/tutorial/job-1/recording.mp4",
    );

    expect(res.enqueued).toBe(true);
    expect(updateTutorialJob).toHaveBeenCalledWith(
      db,
      "job-1",
      expect.objectContaining({
        recording_path: "/media/tutorial/job-1/recording.mp4",
        status: "AWAITING_UPLOAD",
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "tutorial-splice",
      { jobId: "job-1" },
      expect.objectContaining({ jobId: "tutorial-splice-job-1" }),
    );
  });

  it("does NOT enqueue a second splice while one is already in flight", async () => {
    queueGetJob.mockResolvedValue({
      getState: async () => "active",
      remove: vi.fn(),
    });

    const res = await publishRecording(
      db,
      job,
      "/media/tutorial/job-1/recording.mp4",
    );

    expect(res.enqueued).toBe(false);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("clears a settled job so a genuine re-take is spliced again", async () => {
    const remove = vi.fn(async () => undefined);
    queueGetJob.mockResolvedValue({
      getState: async () => "completed",
      remove,
    });

    const res = await publishRecording(
      db,
      job,
      "/media/tutorial/job-1/recording.mp4",
    );

    expect(remove).toHaveBeenCalled();
    expect(res.enqueued).toBe(true);
    expect(queueAdd).toHaveBeenCalled();
  });

  it("refuses to publish a zero-byte file instead of letting the splice ffprobe it", async () => {
    statMock.mockResolvedValue({ isFile: () => true, size: 0 });

    await expect(
      publishRecording(db, job, "/media/tutorial/job-1/recording.mp4"),
    ).rejects.toThrow(/Refusing to publish/);
    expect(updateTutorialJob).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("marks a LONG_FORM part RECORDED and never enqueues a splice", async () => {
    const part = {
      id: "part-1",
      mode: "LONG_FORM",
      parent_job_id: "parent-1",
      recording_path: null,
    } as never;

    const res = await publishRecording(
      db,
      part,
      "/media/tutorial/part-1/recording.mp4",
    );

    expect(res.enqueued).toBe(false);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(updateTutorialJob).toHaveBeenCalledWith(
      db,
      "part-1",
      expect.objectContaining({ status: "RECORDED" }),
    );
  });

  it("throws (does not silently skip) when REDIS_URL is missing", async () => {
    delete process.env["REDIS_URL"];

    await expect(
      publishRecording(db, job, "/media/tutorial/job-1/recording.mp4"),
    ).rejects.toThrow(/REDIS_URL/);
  });
});
