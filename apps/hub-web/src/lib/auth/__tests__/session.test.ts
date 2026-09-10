import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), rows: vi.fn(), cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("../jwt", () => ({ verifyToken: mocks.verify, signToken: vi.fn() }));
vi.mock("@/lib/db", () => ({ users: { id: "id", email: "email", role: "role", is_active: "active" }, db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }) } }));
import { getSession } from "../session";
describe("live session permissions", () => {
  beforeEach(() => { mocks.cookie.mockReturnValue({ value: "cookie" }); mocks.verify.mockResolvedValue({ userId: "va", email: "old@test", role: "ADMIN" }); });
  it("uses current role instead of stale admin grant", async () => {
    mocks.rows.mockResolvedValue([{ id: "va", email: "new@test", role: "TUTORIAL_VA", active: true }]);
    expect(await getSession()).toMatchObject({ role: "TUTORIAL_VA", email: "new@test" });
  });
  it("rejects deactivated and deleted accounts", async () => {
    mocks.rows.mockResolvedValue([{ id: "va", active: false }]); expect(await getSession()).toBeNull();
    mocks.rows.mockResolvedValue([]); expect(await getSession()).toBeNull();
  });
  it("fails closed when account lookup fails", async () => {
    mocks.rows.mockRejectedValue(new Error("database unavailable")); expect(await getSession()).toBeNull();
  });
});
