import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), select: vi.fn(), conditions: [] as unknown[] }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@repo/db");
  return { db: { select: mocks.select }, tutorialJobs: schema.tutorialJobs, tutorialJobEvents: schema.tutorialJobEvents, channels: schema.channels, users: schema.users };
});
const { GET } = await import("../route");
function rows(value: unknown[]) {
  const promise = Promise.resolve(value);
  const query = { from: () => query, leftJoin: () => query, innerJoin: () => query,
    where: (condition: unknown) => { mocks.conditions.push(condition); return query; },
    orderBy: () => query, limit: () => query, groupBy: () => query, then: promise.then.bind(promise) };
  mocks.select.mockReturnValueOnce(query);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.conditions.length = 0;
  mocks.session.mockResolvedValue({ userId: "owner-id", role: "TUTORIAL_VA" }); mocks.permission.mockReturnValue(true);
});
it("requires production permission", async () => {
  mocks.permission.mockReturnValue(false);
  expect((await GET(new Request("http://localhost"))).status).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("rejects malformed and incomplete paging cursors", async () => {
  expect((await GET(new Request("http://localhost?beforeAt=2026-09-08T00:00:00Z"))).status).toBe(400);
  expect((await GET(new Request("http://localhost?days=1000"))).status).toBe(400);
});
it("scopes every archive and aggregate query to the VA despite supplied owner parameter", async () => {
  rows([]); rows([]); rows([{ count: 0 }]);
  const response = await GET(new Request("http://localhost?owner=someone-else"));
  expect(response.status).toBe(200);
  const dialect = new PgDialect();
  for (const condition of mocks.conditions) expect(dialect.sqlToQuery(condition as never).params).toContain("owner-id");
  expect(mocks.conditions).toHaveLength(3);
});
it("allows only Admin to see all producers", async () => {
  mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
  rows([]); rows([]); rows([{ count: 0 }]);
  const response = await GET(new Request("http://localhost"));
  expect(await response.json()).toMatchObject({ scope: "All producers", note: expect.stringContaining("not VA working time") });
  const dialect = new PgDialect();
  for (const condition of mocks.conditions) expect(dialect.sqlToQuery(condition as never).params).not.toContain("admin");
});
