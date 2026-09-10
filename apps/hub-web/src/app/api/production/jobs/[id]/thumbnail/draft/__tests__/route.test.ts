import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), insert: vi.fn(), commit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: (_: unknown, permission: string) => permission === "manage:thumbnails" }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select, insert: mocks.insert, transaction: async (fn: (tx: unknown) => unknown) => fn({ select: mocks.select, insert: mocks.insert }) }, tutorialJobs: {}, thumbnails: {}, tutorialUploadDispatches: {}, tutorialThumbnailDrafts: {} }));
const { POST } = await import("../route");
const jobId = "11111111-1111-4111-8111-111111111111";
const layout = { aspectRatio: "16:9", elements: [{ id: "logo", type: "LOGO", x: 0, y: 0, width: 100, height: 100, zIndex: 1 }] };
function rows(values: unknown[]) { const promise = Promise.resolve(values); const q = { from: () => q, where: () => q, limit: () => q, for: () => q, then: promise.then.bind(promise) }; mocks.select.mockReturnValueOnce(q); }
function request(revision = 0) { return POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ layout, revision, baseThumbnailId: null }) }), { params: Promise.resolve({ id: jobId }) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "owner", role: "VA" }); mocks.insert.mockReturnValue({ values: () => ({ onConflictDoUpdate: mocks.commit }) }); mocks.commit.mockResolvedValue(undefined); });
it("rejects another VA before writing or opening a transaction", async () => { rows([{ id: jobId, created_by: "other" }]); expect((await request()).status).toBe(403); expect(mocks.insert).not.toHaveBeenCalled(); });
it("rejects documents too large to reload before a database write", async () => { const response = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ layout, revision: 0, baseThumbnailId: null, padding: "x".repeat(50_000) }) }), { params: Promise.resolve({ id: jobId }) }); expect(response.status).toBe(400); expect(mocks.insert).not.toHaveBeenCalled(); });
it("saves an incomplete draft without image/provider calls or changing approvals", async () => { rows([{ id: jobId, created_by: "owner" }]); rows([{ id: jobId }]); rows([{ id: jobId }]); rows([]); rows([]); rows([]); const response = await request(); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ revision: 1, approved: false, selectedThumbnailUnchanged: true }); expect(mocks.insert).toHaveBeenCalledOnce(); });
it("rejects a concurrent newer draft without overwriting it", async () => { rows([{ id: jobId, created_by: "owner" }]); rows([{ id: jobId }]); rows([{ id: jobId }]); rows([]); rows([]); rows([{ revision: 2 }]); expect((await request(1)).status).toBe(409); expect(mocks.insert).not.toHaveBeenCalled(); });
it("rejects changes once delivery started", async () => { rows([{ id: jobId, created_by: "owner" }]); rows([{ id: jobId }]); rows([{ id: jobId, uploaded: true }]); rows([]); expect((await request()).status).toBe(409); expect(mocks.insert).not.toHaveBeenCalled(); });
