import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getSession }));

import { resolveTutorialIntakePrincipal } from "../auth";

const request = (token: string) => new NextRequest("https://studio.test/api/v1/tutorial/jobs", {
  headers: { Authorization: `Bearer ${token}` },
});

describe("source-bound tutorial intake authentication", () => {
  beforeEach(() => {
    vi.stubEnv("CF_API_TOKEN", "general-machine-token");
    vi.stubEnv("KT_INGEST_TOKEN", "dedicated-keyword-token");
    vi.stubEnv("KT_EXTERNAL_SOURCE", "keyword-tool.omar");
    getSession.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("derives the source from the dedicated credential", async () => {
    await expect(resolveTutorialIntakePrincipal(request("dedicated-keyword-token"))).resolves.toMatchObject({
      kind: "machine",
      externalSource: "keyword-tool.omar",
    });
  });

  it("does not turn a wrong dedicated token into source authority", async () => {
    await expect(resolveTutorialIntakePrincipal(request("wrong"))).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed when the bound source is malformed", async () => {
    vi.stubEnv("KT_EXTERNAL_SOURCE", "Keyword Tool");
    await expect(resolveTutorialIntakePrincipal(request("dedicated-keyword-token"))).rejects.toMatchObject({ status: 503 });
  });

  it("rejects reuse of the general machine credential", async () => {
    vi.stubEnv("CF_API_TOKEN", "dedicated-keyword-token");
    await expect(resolveTutorialIntakePrincipal(request("dedicated-keyword-token"))).rejects.toMatchObject({
      status: 503,
      message: "KT_INGEST_TOKEN must not reuse CF_API_TOKEN",
    });
  });
});
