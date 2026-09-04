import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockHasPermission = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock("@/lib/db", () => ({ db: {}, tutorialJobs: {} }));
vi.mock("@repo/queue", () => ({
  createRedisConnection: vi.fn(),
  createTutorialTranslateQueue: vi.fn(),
}));

const { POST } = await import("../route");

const SOURCE_JOB_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new Request(
    "https://hub.example/api/production/tutorial-translate/enqueue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as never;
}

describe("POST /api/production/tutorial-translate/enqueue language scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ userId: "u1", role: "TUTORIAL_VA" });
    mockHasPermission.mockReturnValue(true);
  });

  it("rejects non-standard languages in automatic fan-out", async () => {
    const response = await POST(
      request({
        sourceJobId: SOURCE_JOB_ID,
        languages: ["de", "it"],
        mode: "automatic",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/restricted to de, fr, es, ja, ko/i),
    });
  });

  it("rejects unknown automatic targets instead of silently dropping them", async () => {
    const response = await POST(
      request({
        sourceJobId: SOURCE_JOB_ID,
        languages: ["de", "xx"],
        mode: "automatic",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/restricted to de, fr, es, ja, ko/i),
    });
  });

  it("allows only one language per explicit manual request", async () => {
    const response = await POST(
      request({
        sourceJobId: SOURCE_JOB_ID,
        languages: ["it", "pt"],
        mode: "manual",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/exactly one language/i),
    });
  });

  it("treats legacy requests without a mode as manual", async () => {
    const response = await POST(
      request({
        sourceJobId: SOURCE_JOB_ID,
        languages: ["de", "fr"],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/exactly one language/i),
    });
  });
});
