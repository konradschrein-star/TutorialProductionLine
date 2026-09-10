import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), access: vi.fn(), rows: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: m.permission }));
vi.mock("@/lib/tutorial/delivery-access", () => ({ mayAccessDelivery: m.access }));
vi.mock("@/lib/tutorial/verify-publication-approval", () => ({ verifyPublicationApproval: m.verify }));
vi.mock("@/lib/db", () => {
  const db = { select: () => { const q: any = { from: () => q, where: () => q, for: () => q, then: (resolve: any) => Promise.resolve(m.rows()).then(resolve) }; return q; }, transaction: (run: any): any => run(db) };
  return { db, tutorialJobs: { id: {} }, channels: { id: {} }, tutorialUploadDispatches: { tutorial_job_id: {} }, tutorialSourceRevision: () => "revision" };
});
const { GET } = await import("../route");
const id = "10000000-0000-4000-8000-000000000001";
const request = () => GET(new Request("http://localhost/manual"), { params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ userId: "owner", role: "TUTORIAL_VA" }); m.permission.mockImplementation((_session: unknown, permission: string) => ["view:production", "create:tutorial-job"].includes(permission)); m.access.mockResolvedValue(true); });
it("lets an owning producer reach approval validation without broad uploader permission", async () => {
  m.rows.mockResolvedValue([{ id, created_by: "owner", source_job_id: null, va_review_status: null }]);
  expect((await request()).status).toBe(409);
  expect(m.access).toHaveBeenCalled();
  expect(m.verify).not.toHaveBeenCalled();
});
it("rejects another producer's work before approval or asset access", async () => {
  m.rows.mockResolvedValue([{ id, created_by: "other" }]); m.access.mockResolvedValue(false);
  expect((await request()).status).toBe(403);
  expect(m.rows).toHaveBeenCalledTimes(1);
  expect(m.verify).not.toHaveBeenCalled();
});
it("does not allow a read-only viewer to obtain manual handoffs", async () => {
  m.permission.mockImplementation((_s: unknown, p: string) => p === "view:production");
  expect((await request()).status).toBe(403);
  expect(m.rows).not.toHaveBeenCalled();
});
it("blocks manually duplicating an existing connected dispatch", async () => {
  const job = { id, created_by: "owner", source_job_id: null, va_review_status: "approved" };
  m.rows.mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([{ id: "dispatch" }]);
  expect((await request()).status).toBe(409);
  expect(m.verify).not.toHaveBeenCalled();
});
it("returns a portable owner handoff only after current approval is verified", async () => {
  const job = { id, title: "Demo", language: "en", created_by: "owner", channel_id: id, source_job_id: null, va_review_status: "approved" };
  m.rows.mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id, name: "Assigned", language: "en" }]);
  m.verify.mockResolvedValue({ revision: "approved-exact", identity: { thumbnailId: id }, video: { sha256: "video" }, thumbnail: { sha256: "thumbnail" } });
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).approvalRevision).toBe("approved-exact");
  expect(m.verify).toHaveBeenCalledTimes(1);
});
