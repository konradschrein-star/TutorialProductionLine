import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  select: vi.fn(),
  conditions: [] as any[],
  limits: [] as number[],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@repo/db");
  return {
    db: { select: mocks.select },
    tutorialJobs: schema.tutorialJobs,
    channels: schema.channels,
    users: schema.users,
  };
});
const { GET } = await import("../route");
const owner = "10000000-0000-4000-8000-000000000001",
  parent = "20000000-0000-4000-8000-000000000001";
function rows(value: any[]) {
  const promise = Promise.resolve(value);
  const query = {
    from: () => query,
    leftJoin: () => query,
    innerJoin: () => query,
    where: (condition: any) => {
      mocks.conditions.push(condition);
      return query;
    },
    orderBy: () => query,
    groupBy: () => query,
    limit: (n: number) => {
      mocks.limits.push(n);
      return query;
    },
    then: promise.then.bind(promise),
  };
  mocks.select.mockReturnValueOnce(query);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.conditions = [];
  mocks.limits = [];
  mocks.session.mockResolvedValue({ userId: owner, role: "TUTORIAL_VA" });
  mocks.permission.mockReturnValue(true);
});
it("requires production read access", async () => {
  mocks.permission.mockReturnValue(false);
  expect((await GET(new Request("http://local"))).status).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("rejects invalid stages, cursors and unauthorized producer filters before DB access", async () => {
  for (const suffix of [
    "?stage=NOT_A_STAGE",
    "?beforeId=" + parent,
    "?channelId=bad",
  ])
    expect((await GET(new Request("http://local" + suffix))).status).toBe(400);
  expect(
    (await GET(new Request("http://local?producerId=" + parent))).status,
  ).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("scopes roots, totals and channel options to current VA", async () => {
  rows([]);
  rows([{ count: 0 }]);
  rows([]);
  const result = await GET(new Request("http://local?q=50%25_"));
  expect(result.status).toBe(200);
  const dialect = new PgDialect();
  for (const condition of mocks.conditions)
    expect(dialect.sqlToQuery(condition).params).toContain(owner);
  expect(mocks.conditions).toHaveLength(3);
  expect(await result.json()).toMatchObject({
    canFilterProducer: false,
    producers: [],
    total: 0,
  });
  expect(result.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.limits).toEqual([26, 200]);
});
it("cannot inspect locales of another owner's root", async () => {
  rows([]);
  expect(
    (await GET(new Request("http://local?parentId=" + parent))).status,
  ).toBe(404);
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(new PgDialect().sqlToQuery(mocks.conditions[0]).params).toContain(
    owner,
  );
});
it("scopes locale children independently and returns only bounded page", async () => {
  rows([{ id: parent }]);
  rows([]);
  const result = await GET(new Request("http://local?parentId=" + parent));
  expect(result.status).toBe(200);
  for (const condition of mocks.conditions)
    expect(new PgDialect().sqlToQuery(condition).params).toContain(owner);
  expect(mocks.limits).toEqual([1, 26]);
});
it("Admin can filter a producer; unsafe YouTube URLs are not exposed", async () => {
  mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
  rows([
    {
      id: parent,
      cursorAt: "2026-09-08T00:00:00Z",
      youtubeRaw: "https://evil.test/private",
      title: "Synthetic",
    },
  ]);
  rows([{ count: 1 }]);
  rows([]);
  rows([]);
  const response = await GET(new Request("http://local?producerId=" + owner));
  const result = await response.json();
  expect(result.canFilterProducer).toBe(true);
  expect(result.rows[0]).toMatchObject({
    youtubeUrl: null,
    youtubeStudioUrl: null,
  });
  expect(result.rows[0]).not.toHaveProperty("youtubeRaw");
  expect(new PgDialect().sqlToQuery(mocks.conditions[0]).params).toContain(
    owner,
  );
});
it("uses keyset paging and returns a precise next cursor", async () => {
  rows(
    Array.from({ length: 26 }, (_, index) => ({
      id: String(index),
      cursorAt: "2026-09-08T00:00:00.123456Z",
      youtubeRaw: null,
    })),
  );
  rows([{ count: 100 }]);
  rows([]);
  const result = await (await GET(new Request("http://local"))).json();
  expect(result.rows).toHaveLength(25);
  expect(result.nextCursor).toEqual({
    beforeId: "24",
    beforeAt: "2026-09-08T00:00:00.123456Z",
  });
});
