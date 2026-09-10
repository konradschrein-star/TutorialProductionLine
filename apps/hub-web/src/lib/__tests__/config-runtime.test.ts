import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@repo/config", async (original) => ({ ...await original<typeof import("@repo/config")>(), loadConfig: mocks.load }));
describe("runtime configuration never silently changes database", () => {
  beforeEach(() => { vi.resetModules(); mocks.load.mockImplementation(() => { throw new Error("sensitive-provider-value"); }); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it.each(["development", "production", "test"])("rejects invalid %s runtime settings", async (mode) => {
    vi.stubEnv("NODE_ENV", mode); vi.stubEnv("NEXT_PHASE", ""); vi.stubEnv("VITEST", "false");
    const { getHubConfig } = await import("../config");
    expect(() => getHubConfig()).toThrow();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive-provider-value");
  });
  it("allows a placeholder only during explicit build evaluation", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { getHubConfig } = await import("../config");
    expect(getHubConfig().DATABASE_URL).toBe("postgresql://localhost:5432/mock");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("sensitive-provider-value");
  });
});
