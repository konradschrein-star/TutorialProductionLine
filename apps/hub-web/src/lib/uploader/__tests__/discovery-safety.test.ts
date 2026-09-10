import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { getSecret, getSettings, query } = vi.hoisted(() => ({ getSecret: vi.fn(), getSettings: vi.fn(), query: vi.fn() }));
vi.mock("@repo/db", () => ({ getSecret }));
vi.mock("@/lib/uploader/settings", () => ({ getUploaderSettings: getSettings }));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, then: (resolve: (rows: unknown) => unknown) => Promise.resolve(query()).then(resolve) };
  return { db: { select: () => chain }, channels: {}, tutorialJobs: {}, storageArtifacts: {}, thumbnails: {} };
});
import { GET as config } from "@/app/api/production/uploader-config/route";
import { GET as jobs } from "@/app/api/production/uploader-jobs/route";
describe("legacy uploader discovery cannot bypass dispatch admission", () => {
  beforeEach(() => {
    vi.clearAllMocks(); getSecret.mockResolvedValue("local-discovery-test-token");
    getSettings.mockResolvedValue({ enabled: true, executionMode: "live", requireManualRelease: false, defaultVisibility: "public" });
    query.mockResolvedValue([]);
  });
  const request = (token = "local-discovery-test-token") => new NextRequest("http://localhost/api/production/uploader-jobs", { headers: { authorization: `Bearer ${token}` } });
  it("rejects unauthenticated inspection", async () => {
    expect((await config(request("wrong"))).status).toBe(401);
    expect((await jobs(request("wrong"))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("never grants execution even when the legacy settings are live", async () => {
    expect(await (await config(request())).json()).toMatchObject({ safety: { mayExecute: false, inspectionOnly: true } });
    expect(await (await jobs(request())).json()).toMatchObject({ safety: { executable: false, inspectionOnly: true } });
  });
  it("also marks each discovered job as blocked", async () => {
    query.mockResolvedValueOnce([{ id: "11111111-2222-4333-8444-555555555551", language: "en", title: "Test", status: "COMPLETED" }]);
    const response = await (await jobs(request())).json();
    expect(response.jobs[0]).toMatchObject({ ready: false, executable: false, blockers: expect.arrayContaining([expect.stringMatching(/Inspection only/)]) });
  });
});
