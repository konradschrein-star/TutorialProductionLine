import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockHasPermission = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock("@/lib/db", () => ({
  channels: {},
  storageArtifacts: {},
  tutorialJobs: { id: {}, is_uploaded: {} },
  tutorialUploadDispatches: { id: {}, tutorial_job_id: {} },
  users: {},
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: (...args: unknown[]) => mockLimit(...args) }),
      }),
    }),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

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
  });

  it("rejects the legacy manual toggle when any dispatch record exists", async () => {
    mockLimit.mockResolvedValue([{ id: "dispatch-from-any-state" }]);

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
});
