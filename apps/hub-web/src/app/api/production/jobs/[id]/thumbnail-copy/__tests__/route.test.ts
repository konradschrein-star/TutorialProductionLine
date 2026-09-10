import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), select: vi.fn(), getJob: vi.fn(), add: vi.fn(), close: vi.fn(), quit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/db", () => {
  const db = { select: mocks.select, transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
  return { db, tutorialJobs: {}, thumbnails: {} };
});
vi.mock("@repo/queue", () => ({ createRedisConnection: () => ({ quit: mocks.quit }), createTutorialTranslateQueue: () => ({ getJob: mocks.getJob, add: mocks.add, close: mocks.close }) }));
const { POST } = await import("../route");
const id = "11111111-1111-4111-8111-111111111111";
const root = { id, source_job_id: null, created_by: "owner", language: "en", status: "COMPLETED" };
function rows(value: unknown[]) {
  const promise = Promise.resolve(value);
  const query = { from: () => query, where: () => query, limit: () => query, for: () => query, then: promise.then.bind(promise) };
  mocks.select.mockReturnValueOnce(query);
}
const request = () => POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://test.invalid");
  mocks.session.mockResolvedValue({ userId: "owner" });
  mocks.permission.mockImplementation((_session, permission) => permission === "manage:thumbnails");
  mocks.getJob.mockResolvedValue(null);
  mocks.add.mockResolvedValue({}); mocks.close.mockResolvedValue(undefined); mocks.quit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("rejects another producer before creating queue work", async () => {
  rows([{ ...root, created_by: "someone-else" }]);
  expect((await request()).status).toBe(403);
  expect(mocks.getJob).not.toHaveBeenCalled();
});
it("preserves existing partial headline text", async () => {
  rows([root]); rows([root]); rows([{ ...root, thumbnail_text_top: "Manual text" }]);
  expect((await request()).status).toBe(409);
  expect(mocks.add).not.toHaveBeenCalled();
});
it("preserves selected thumbnails", async () => {
  rows([root]); rows([root]); rows([root]); rows([{ id: "selected" }]);
  expect((await request()).status).toBe(409);
  expect(mocks.add).not.toHaveBeenCalled();
});
it("queues a bounded idempotent copy job without localization", async () => {
  rows([root]); rows([root]); rows([root]); rows([]);
  expect((await request()).status).toBe(202);
  expect(mocks.add).toHaveBeenCalledWith("tutorial-thumbnail-copy", { sourceJobId: id, targetLanguage: "en", purpose: "thumbnail-copy" }, { jobId: `tutorial-thumbnail-copy-${id}-en`, attempts: 2 });
});
it("retries the retained failed job instead of generating a new identity", async () => {
  rows([root]); rows([root]); rows([root]); rows([]);
  const retry = vi.fn().mockResolvedValue(undefined);
  mocks.getJob.mockResolvedValue({ getState: async () => "failed", retry });
  expect((await request()).status).toBe(202);
  expect(retry).toHaveBeenCalledOnce(); expect(mocks.add).not.toHaveBeenCalled();
});
it("duplicate active requests do not spend again", async () => {
  rows([root]); rows([root]); rows([root]); rows([]);
  mocks.getJob.mockResolvedValue({ getState: async () => "active" });
  expect(await (await request()).json()).toMatchObject({ duplicate: true });
  expect(mocks.add).not.toHaveBeenCalled();
});
it("queue outages are actionable and retain work", async () => {
  rows([root]); rows([root]); rows([root]); rows([]);
  mocks.getJob.mockRejectedValueOnce(new Error("offline"));
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("Your work is intact") });
});
