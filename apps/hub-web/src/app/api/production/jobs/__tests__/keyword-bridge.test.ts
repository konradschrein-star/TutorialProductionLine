import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), channel: vi.fn(), login: vi.fn(), claims: vi.fn(), produce: vi.fn(), create: vi.fn(), bound: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mock.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mock.permission }));
vi.mock("@/lib/tutorial/channel-access", () => ({ getProductionChannelAccess: mock.channel }));
vi.mock("@/lib/keyword-tool/client", () => ({ ktLogin: mock.login, ktGet: mock.claims, ktProduce: mock.produce, KeywordToolError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mock.bound }) }) }) }, tutorialJobs: { id: {} }, users: {} }));
vi.mock("@repo/db", () => ({ createOrReuseTutorialJob: mock.create, listTutorialJobs: vi.fn(), listTutorialJobsByUser: vi.fn() }));
vi.mock("@repo/queue", () => ({ createRedisConnection: vi.fn(), createTutorialGenerateQueue: vi.fn() }));
const { POST } = await import("../route");
const channelId = "11111111-1111-4111-8111-111111111111";
const payload = { keyword_ref: "42", title: "Create account", channel_id: channelId, language: "en", mode: "THREE_MIN", steps_input: "Open Settings", source_mode: "FROM_SCRATCH" };
const request = (extra = {}) => new NextRequest("http://localhost/api/production/jobs", { method: "POST", body: JSON.stringify({ ...payload, ...extra }) });
beforeEach(() => {
  vi.clearAllMocks(); mock.session.mockResolvedValue({ userId: "va" }); mock.permission.mockReturnValue(true);
  mock.channel.mockResolvedValue({ language: "en" }); mock.login.mockResolvedValue({ user: { id: 7 } });
  mock.claims.mockResolvedValue([{ id: 42 }]); mock.produce.mockResolvedValue({ state: "confirmed", forge_job_id: "job-42" });
  mock.bound.mockResolvedValue([{ owner: "va", channelId, keywordRef: "42" }]);
});
describe("browser keyword durable bridge", () => {
  it("uses claimed identity and existing KT production service, never direct job creation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect((await response.json()).jobId).toBe("job-42");
    expect(mock.claims.mock.calls[0]?.[2]).toEqual({ claimed_by: 7, limit: 200 });
    expect(mock.produce.mock.calls[0]?.[2]).toMatchObject({ channel_id: channelId, steps: "Open Settings" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it.each([{ script_provider: "override" }, { tts_voice: "override" }, { custom_prompt: "override" }])("rejects unsupported settings instead of ignoring them", async (extra) => {
    expect((await POST(request(extra))).status).toBe(400); expect(mock.produce).not.toHaveBeenCalled();
  });
  it("rejects unowned claims even for an authenticated session", async () => {
    mock.claims.mockResolvedValue([{ id: 99 }]); expect((await POST(request())).status).toBe(403); expect(mock.produce).not.toHaveBeenCalled();
  });
  it("rejects unauthorized destination and wrong language", async () => {
    mock.channel.mockResolvedValue(null); expect((await POST(request())).status).toBe(403);
    mock.channel.mockResolvedValue({ language: "de" }); expect((await POST(request())).status).toBe(400);
  });
  it("does not acknowledge pending/uncertain intent as created", async () => {
    mock.produce.mockResolvedValue({ state: "uncertain" }); const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ intentState: "uncertain" });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("rejects unsafe reference URLs before network requests", async () => {
    expect((await POST(request({ reference_url: "http://127.0.0.1/private", source_mode: "TRANSCRIPT_REWRITE" }))).status).toBe(400);
    expect(mock.produce).not.toHaveBeenCalled();
  });
  it("does not pretend a saved request used a newly selected destination", async () => {
    mock.bound.mockResolvedValue([{ owner: "va", channelId: "other", keywordRef: "42" }]);
    expect((await POST(request())).status).toBe(409);
    expect(mock.create).not.toHaveBeenCalled();
  });
});
