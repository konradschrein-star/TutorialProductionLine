import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), insert: vi.fn(), values: vi.fn(), commit: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: () => true }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert, delete: mocks.remove } }));
const { PATCH, DELETE } = await import("../route");
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "own-user" }); mocks.insert.mockReturnValue({ values: mocks.values }); mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.commit }); mocks.commit.mockResolvedValue(undefined); });
it("legacy delete only hides in the current user's preferences", async () => {
  const response = await DELETE(new NextRequest("http://localhost/api/thumbnails/assets?id=asset-123"));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ sharedAssetDeleted: false });
  expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ user_id: "own-user", asset_key: "asset-123", hidden: true })); expect(mocks.remove).not.toHaveBeenCalled();
});
it("rotation and restore cannot target another user's collection", async () => {
  const response = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ assetKey: "/background/office.png", hidden: false, includeInRotation: false, user_id: "another-user" }) }));
  expect(response.status).toBe(200); expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ user_id: "own-user", hidden: false, include_in_rotation: false }));
});
it("rejects unauthenticated preference writes", async () => { mocks.session.mockResolvedValue(null); expect((await DELETE(new NextRequest("http://localhost?id=asset"))).status).toBe(403); expect(mocks.insert).not.toHaveBeenCalled(); });
