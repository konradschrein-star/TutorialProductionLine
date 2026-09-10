import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));

import { GET } from "../route";

describe("Keyword Tool embed handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KT_EMBED_URL", "https://keywords.example.test/");
    vi.stubEnv("KT_EMBED_SECRET", "a-secure-shared-test-secret");
    mocks.session.mockResolvedValue({
      userId: "producer",
      email: "producer@example.test",
      role: "PRODUCTION_VA",
    });
    mocks.permission.mockImplementation(
      (_session: unknown, permission: string) =>
        permission === "view:production",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires production visibility", async () => {
    mocks.permission.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("does not disclose the admin destination to a producer VA", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      boardUrl: "https://keywords.example.test/embed/board",
      adminUrl: null,
      canAdmin: false,
    });
    expect(body.url).toMatch(
      /^https:\/\/keywords\.example\.test\/embed\/board\?t=/,
    );
  });

  it("returns the admin destination only with the settings-management permission", async () => {
    mocks.permission.mockReturnValue(true);

    const response = await GET();

    expect(await response.json()).toMatchObject({
      adminUrl: "https://keywords.example.test/admin",
      canAdmin: true,
    });
  });

  it("returns a non-blocking disabled state without minting a URL", async () => {
    vi.stubEnv("KT_ENABLED", "false");

    const response = await GET();

    expect(await response.json()).toEqual({
      integration: "disabled",
      url: null,
    });
  });
});
