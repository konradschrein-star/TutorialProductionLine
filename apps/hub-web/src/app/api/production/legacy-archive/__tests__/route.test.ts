import { beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => vi.fn()); const select = vi.hoisted(() => vi.fn()); const where = vi.hoisted(() => vi.fn()); const limit = vi.hoisted(() => vi.fn()); const route = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getSession: session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: () => true }));
vi.mock("drizzle-orm", () => ({ eq: (a: unknown, b: unknown) => ({ eq: [a, b] }), gt: (a: unknown, b: unknown) => ({ gt: [a, b] }), and: (...items: unknown[]) => items.filter(Boolean), or: (...items: unknown[]) => ({ or: items }), ilike: (a: unknown, b: unknown) => ({ ilike: [a, b] }), isNull: (a: unknown) => ({ null: a }), asc: (a: unknown) => a }));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, where: (...args: unknown[]) => { where(...args); return chain; }, orderBy: () => chain, limit };
  return { db: { select: (...args: unknown[]) => { select(...args); return chain; } }, tutorialLegacyArchive: { id: "archive.id", owner_user_id: "archive.owner", title: "archive.title", source_status: "archive.status" }, channels: {}, users: {} };
});
vi.mock("@/lib/tutorial/channel-access", () => ({ mayProduceOnChannel: () => false }));
vi.mock("@/lib/tutorial/legacy-archive-routing", () => ({ routeLegacyArchive: route, ArchiveRoutingError: class extends Error {} }));
import { GET, POST } from "../route";
const request = (query = "") => new Request(`https://studio.example/api/production/legacy-archive${query}`);
describe("protected archive API", () => {
  beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue({ role: "TUTORIAL_VA", userId: "owner" }); limit.mockResolvedValue([]); });
  it("requires a session before archive access", async () => { session.mockResolvedValue(null); expect((await GET(request())).status).toBe(401); expect(select).not.toHaveBeenCalled(); });
  it("scopes VA reads to their own imported records", async () => { const response = await GET(request()); expect(response.status).toBe(200); expect(where.mock.calls[0]![0]).toContainEqual({ eq: ["archive.owner", "owner"] }); expect((await response.json()).canRoute).toBe(false); });
  it("never selects raw JSON, password hashes or archive fingerprints", async () => { const response = await GET(request()); const selected = Object.keys(select.mock.calls[0]![0]); expect(selected).not.toContain("source_json"); expect(selected).not.toContain("snapshot_sha256"); expect(selected).not.toContain("password_hash"); expect((await response.json()).rawSourceExposed).toBe(false); });
  it("requires Admin for routing", async () => { expect((await POST(new Request(request(), { method: "POST", body: "{}" }))).status).toBe(403); expect(route).not.toHaveBeenCalled(); });
  it("validates cursor and filters", async () => { expect((await GET(request("?after=garbage"))).status).toBe(400); expect(select).not.toHaveBeenCalled(); });
  it("does not interpret search wildcards as an archive dump", async () => { await GET(request("?q=%25")); expect(JSON.stringify(where.mock.calls[0])).toContain("\\\\%"); });
});
