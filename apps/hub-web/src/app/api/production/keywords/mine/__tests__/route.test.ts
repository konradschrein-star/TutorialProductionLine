import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), login: vi.fn(), get: vi.fn(), select: vi.fn(), where: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mock.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mock.permission }));
vi.mock("@/lib/keyword-tool/client", () => ({ ktLogin: mock.login, ktGet: mock.get, ktKeywordUrl: (id: number) => `https://kt.test/board?kid=${id}`, KeywordToolError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ db: { select: mock.select }, tutorialJobs: { id: "id", keyword_ref: "ref", status: "status", title: "title", created_by: "owner", source_job_id: "source", channel_id: "channel" } }));
vi.mock("drizzle-orm", () => ({ and: (...args: unknown[]) => ({ and: args }), eq: (...args: unknown[]) => ({ eq: args }), inArray: (...args: unknown[]) => ({ inArray: args }), isNull: (arg: unknown) => ({ isNull: arg }) }));
const { GET } = await import("../route");
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KT_ENABLED", "true"); vi.stubEnv("KT_EMBED_URL", "https://kt.test"); vi.stubEnv("KT_EMBED_SECRET", "test-only");
  mock.session.mockResolvedValue({ userId: "va1" }); mock.permission.mockReturnValue(true);
  mock.login.mockResolvedValue({ user: { id: 7, name: "Test VA" } });
  mock.get.mockResolvedValue([{ id: 1, keyword: "Test", status: "RECORDING" }]);
  mock.select.mockReturnValue({ from: () => ({ where: mock.where }) });
  mock.where.mockResolvedValue([{ id: "job1", keywordRef: "1", status: "QUEUED", title: "Test", channelId: "channel1" }]);
});
afterEach(() => vi.unstubAllEnvs());
describe("claimed keyword view", () => {
  it("requires permission before disclosing configuration", async () => {
    mock.permission.mockReturnValue(false);
    expect((await GET(new Request("https://studio.test/api/production/keywords/mine"))).status).toBe(403);
    expect(mock.login).not.toHaveBeenCalled();
  });
  it("disabled integration is a neutral state and performs no network or database call", async () => {
    vi.stubEnv("KT_ENABLED", "false");
    const response = await GET(new Request("https://studio.test/api/production/keywords/mine"));
    expect(response.status).toBe(200); expect((await response.json()).integration).toBe("disabled");
    expect(mock.login).not.toHaveBeenCalled(); expect(mock.select).not.toHaveBeenCalled();
  });
  it("scopes the join to owned originals and keeps queued work unfinished", async () => {
    const body = await (await GET(new Request("https://studio.test/api/production/keywords/mine"))).json();
    expect(mock.where).toHaveBeenCalledWith({ and: [{ inArray: ["ref", ["1"]] }, { eq: ["owner", "va1"] }, { isNull: "source" }] });
    expect(body).toMatchObject({ remaining: 1, produced: 0, unstarted: 0 });
    expect(body.keywords[0]).toMatchObject({ assignedChannelId: "channel1", job: { id: "job1", status: "QUEUED" } });
  });
  it("counts actual render completion separately", async () => {
    mock.where.mockResolvedValue([{ id: "job1", keywordRef: "1", status: "COMPLETED" }]);
    const body = await (await GET(new Request("https://studio.test/api/production/keywords/mine"))).json();
    expect(body).toMatchObject({ remaining: 0, produced: 1 });
  });
});
