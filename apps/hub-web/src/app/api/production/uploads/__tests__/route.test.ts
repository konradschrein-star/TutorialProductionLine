import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockHasPermission = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockEvent = vi.fn();
vi.mock("@/lib/tutorial/verify-publication-approval", () => ({ verifyPublicationApproval: async () => ({}) }));

vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock("@/lib/db", () => {
  const database = {
    select: () => { const chain = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve(mockLimit()).then(resolve) }; return chain; },
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: () => ({ values: (...args: unknown[]) => mockEvent(...args) }),
    transaction: (run: (tx: unknown) => unknown): unknown => run(database),
  };
  return {
  channels: {},
  storageArtifacts: {},
  tutorialJobs: { id: {}, is_uploaded: {} },
  tutorialUploadDispatches: { id: {}, tutorial_job_id: {} },
  tutorialJobEvents: {},
  users: {},
  tutorialSourceRevision: () => "source-revision",
  db: database,
}; });

const { PATCH } = await import("../route");

function request(body: unknown) {
  return new Request("https://hub.example/api/production/uploads", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/production/uploads duplicate-upload rail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ userId: "u1", role: "ADMIN" });
    mockHasPermission.mockReturnValue(true);
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: async () => [] });
  });

  it("rejects the legacy manual toggle when any dispatch record exists", async () => {
    const job = { id: "11111111-1111-4111-8111-111111111111", created_by: "u1" };
    mockLimit.mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([{ id: "dispatch-from-any-state" }]);

    const response = await PATCH(
      request({
        jobId: "11111111-1111-4111-8111-111111111111",
        isUploaded: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/locked.*dispatch/i),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("does not let a VA alter another producer's manual delivery status", async () => {
    mockGetSession.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
    mockHasPermission.mockImplementation((_session, permission) => permission === "manage:thumbnails");
    mockLimit.mockResolvedValueOnce([{ id: "11111111-1111-4111-8111-111111111111", created_by: "other" }]);
    expect((await PATCH(request({ jobId: "11111111-1111-4111-8111-111111111111", isUploaded: true }))).status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("rejects truthy strings instead of interpreting them as upload confirmation", async () => {
    expect((await PATCH(request({ jobId: "11111111-1111-4111-8111-111111111111", isUploaded: "false" }))).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("records a manual report without fabricating public visibility or publication time", async () => {
    const job = { id: "11111111-1111-4111-8111-111111111111", created_by: "u1", va_review_status: "approved" };
    mockLimit.mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
    const response = await PATCH(request({ jobId: job.id, isUploaded: true, youtubeUrl: "https://youtu.be/abcdefghijk" }));
    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ uploader_status: "reported_uploaded", youtube_visibility: null, youtube_published_at: null, upload_verified_at: null, youtube_upload_url: "https://www.youtube.com/watch?v=abcdefghijk" }));
    expect(await response.json()).toMatchObject({ verified: false, publicationConfirmed: false });
    expect(mockEvent).toHaveBeenCalledWith(expect.objectContaining({ actor_id: "u1", event_type: "manual_upload_reported", payload: expect.objectContaining({ verified: false }) }));
  });
});
