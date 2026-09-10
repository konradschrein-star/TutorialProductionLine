import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  select: vi.fn(),
  predicates: [] as unknown[],
  sources: [] as unknown[],
  translations: [] as unknown[],
  channels: [] as unknown[],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mock.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mock.permission }));
vi.mock("@/lib/db", () => ({
  db: { select: mock.select },
  tutorialJobs: {
    id: "id",
    source_job_id: "source_job_id",
    status: "status",
    language: "language",
    created_by: "created_by",
    completed_at: "completed_at",
  },
  channels: { id: "channel_id", language: "channel_language", is_primary: "is_primary", metadata: "metadata", accepts_tutorials: "accepts_tutorials" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (value: unknown) => value,
  isNull: (value: unknown) => ({ isNull: value }),
  isNotNull: (value: unknown) => ({ isNotNull: value }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  }),
}));
const { GET } = await import("../route");
const request = (query = "") =>
  new Request(`https://studio.test/api/production/tutorial-translate${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mock.predicates = [];
  mock.sources = [
    {
      id: "source",
      title: "Synthetic original",
      language: "en",
      createdAt: null,
      createdBy: "va",
    },
  ];
  mock.translations = [
    {
      id: "child",
      sourceId: "source",
      language: "de",
      status: "FAILED_RENDER",
    },
  ];
  mock.channels = [];
  mock.session.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
  mock.permission.mockImplementation(
    (_session, permission) => permission === "view:production",
  );
  let count = 0;
  mock.select.mockImplementation(() => {
    const rows = count++ === 0 ? mock.sources : count === 2 ? mock.translations : mock.channels;
    const chain = {
      from: () => chain,
      where: (predicate: unknown) => {
        mock.predicates.push(predicate);
        return chain;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve),
    };
    return chain;
  });
});
describe("localization overview ownership", () => {
  it("targeted lookup retains owner constraint and filters the ID before the list limit", async () => {
    const id = "11111111-1111-4111-8111-111111111551";
    await GET(request(`?sourceJobId=${id}&scope=all`));
    expect(mock.predicates[0]).toMatchObject({
      and: expect.arrayContaining([
        { eq: ["id", id] },
        { eq: ["created_by", "va"] },
      ]),
    });
  });
  it("invalid targeted lookup fails before querying", async () => {
    expect((await GET(request("?sourceJobId=invalid"))).status).toBe(400);
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("unauthorized or absent targeted source does not reveal child metadata", async () => {
    mock.sources = [];
    const response = await GET(
      request("?sourceJobId=11111111-1111-4111-8111-111111111551"),
    );
    expect(await response.json()).toMatchObject({ sources: [] });
    expect(mock.select).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthenticated and performs no DB query", async () => {
    mock.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("rejects missing production permission", async () => {
    mock.permission.mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(mock.select).not.toHaveBeenCalled();
  });
  it.each(["", "?scope=all"])(
    "VA cannot broaden owner scope: %s",
    async (query) => {
      const body = await (await GET(request(query))).json();
      expect(mock.predicates[0]).toMatchObject({
        and: expect.arrayContaining([
          { eq: ["created_by", "va"] },
          { isNull: "source_job_id" },
          { eq: ["status", "COMPLETED"] },
        ]),
      });
      expect(JSON.stringify(mock.predicates[0])).toContain("('en', 'english')");
      expect(body).toMatchObject({
        scope: "mine",
        canSeeEveryone: false,
        sources: [
          {
            mine: true,
            canAct: true,
            translations: [
              { id: "child", language: "de", status: "FAILED_RENDER" },
            ],
          },
        ],
      });
      expect(mock.predicates[1]).toMatchObject({
        and: expect.arrayContaining([
          { inArray: ["source_job_id", ["source"]] },
        ]),
      });
    },
  );
  it.each(["ADMIN", "MANAGER"])(
    "%s may explicitly request everyone",
    async (role) => {
      mock.session.mockResolvedValue({ userId: "admin", role });
      const body = await (await GET(request("?scope=all"))).json();
      expect(JSON.stringify(mock.predicates[0])).not.toContain("created_by");
      expect(body).toMatchObject({
        scope: "all",
        canSeeEveryone: true,
        sources: [{ mine: false, canAct: true }],
      });
    },
  );
  it("Admin defaults to own work until all is requested", async () => {
    mock.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
    await GET(request());
    expect(mock.predicates[0]).toMatchObject({
      and: expect.arrayContaining([{ eq: ["created_by", "admin"] }]),
    });
  });
  it("does not query children when no authorized sources exist", async () => {
    mock.sources = [];
    expect(await (await GET(request())).json()).toMatchObject({ sources: [] });
    expect(mock.select).toHaveBeenCalledTimes(1);
  });
});
