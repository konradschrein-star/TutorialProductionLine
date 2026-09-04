import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockHasPermission = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock("@/lib/db", () => ({
  db: {},
  channels: {},
  thumbnails: {},
  tutorialJobs: {},
  tutorialUploadDispatches: {},
}));

const { POST } = await import("../route");

const params = Promise.resolve({
  id: "11111111-1111-4111-8111-111111111111",
});

function request(body: unknown) {
  return new Request(
    "https://hub.example/api/production/jobs/11111111-1111-4111-8111-111111111111/uploader-dispatch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as never;
}

const validBody = {
  visibility: "private",
  made_for_kids: false,
  monetization: "off",
};

describe("POST tutorial uploader dispatch authorization and declarations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ userId: "u1", role: "ADMIN" });
    mockHasPermission.mockReturnValue(false);
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST(request(validBody), { params })).status).toBe(401);
  });

  it("checks the mutating upload permission, not read-only production access", async () => {
    const response = await POST(request(validBody), { params });

    expect(response.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ role: "ADMIN" }),
      "upload:youtube-video",
    );
  });

  it("rejects a missing explicit audience declaration before database access", async () => {
    mockHasPermission.mockReturnValue(true);
    const response = await POST(
      request({ visibility: "private", monetization: "off" }),
      { params },
    );

    expect(response.status).toBe(400);
  });

  it("requires ad-suitability confirmation only when monetization is on", async () => {
    mockHasPermission.mockReturnValue(true);
    const response = await POST(
      request({
        visibility: "private",
        made_for_kids: false,
        monetization: "on",
      }),
      { params },
    );

    expect(response.status).toBe(400);
  });
});
