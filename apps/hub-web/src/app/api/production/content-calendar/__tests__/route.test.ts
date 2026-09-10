import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), select: vi.fn(), eq: vi.fn((a: unknown,b: unknown) => ({ a,b })) }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: (...conditions: unknown[]) => conditions, asc: (value: unknown) => value, gte: (a: unknown,b: unknown) => ({a,b}), lt: (a: unknown,b: unknown) => ({a,b}), ne: (a: unknown,b: unknown) => ({a,b}), isNotNull: (value: unknown) => value }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select }, tutorialJobs: { created_by: "owner-column" }, channels: {} }));
import { GET } from "../route";
function rows(values: unknown[]) { const promise = Promise.resolve(values); const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, then: promise.then.bind(promise) }; mocks.select.mockReturnValueOnce(chain); }
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockReturnValue(true); mocks.session.mockResolvedValue({ role: "TUTORIAL_VA", userId: "owner" }); });
it("rejects unauthenticated requests without reading calendar data", async () => { mocks.session.mockResolvedValue(null); expect((await GET(new Request("http://local?start=2026-09-09"))).status).toBe(403); expect(mocks.select).not.toHaveBeenCalled(); });
it("rejects invalid dates before querying", async () => { expect((await GET(new Request("http://local?start=2026-02-30"))).status).toBe(400); expect(mocks.select).not.toHaveBeenCalled(); });
it("scopes a VA to their own jobs and exposes no global channel inventory", async () => {
  rows([{ id: "job", channelId: "assigned", channelName: "Assigned", channelLanguage: "de", metadata: {}, publishAt: new Date("2026-09-09T12:00:00Z") }]);
  const body = await (await GET(new Request("http://local?start=2026-09-09"))).json();
  expect(mocks.eq).toHaveBeenCalledWith("owner-column", "owner");
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(body).toMatchObject({ scope: "own", canManage: false, truncated: false, channels: [{ id: "assigned", schedule: { dailyCapacity: 30 } }] });
  expect(body.rows[0]).not.toHaveProperty("metadata");
});
it("reports Admin installation scope and preserves configured capacity", async () => {
  mocks.session.mockResolvedValue({ role: "ADMIN", userId: "admin" }); rows([]); rows([{ id: "assigned", name: "Assigned", language: "en", metadata: { tutorialSchedule: { dailyCapacity: 42 } } }]);
  const body = await (await GET(new Request("http://local?start=2026-09-09"))).json();
  expect(mocks.eq).not.toHaveBeenCalledWith("owner-column", "admin");
  expect(body).toMatchObject({ scope: "installation", canManage: true, channels: [{ schedule: { dailyCapacity: 42 } }] });
});
