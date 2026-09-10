import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), add: vi.fn(), getJob: vi.fn(), close: vi.fn(), quit: vi.fn(), connect: vi.fn(), insert: vi.fn(), values: vi.fn(), readiness: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: (_: unknown, permission: string) => permission === "manage:thumbnails" }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select, transaction: async (fn: (tx: unknown) => unknown) => fn({ select: mocks.select, insert: mocks.insert }) }, tutorialJobs: {}, thumbnails: {}, tutorialUploadDispatches: {}, tutorialSettings: {}, tutorialThumbnailAiBatches: {}, tutorialThumbnailFanout: {} }));
vi.mock("@/lib/tutorial/ai-provider-readiness", () => ({ getTutorialAiProviderReadiness: mocks.readiness }));
vi.mock("@repo/queue", () => ({ createRedisConnection: mocks.connect, createThumbnailQueue: () => ({ add: mocks.add, getJob: mocks.getJob, close: mocks.close }) }));
vi.mock("@/app/api/_lib/runtime", () => ({ getV1Runtime: () => ({ redisUrl: "mock" }) }));
const { POST, GET } = await import("../route");
const job = { id: "11111111-1111-4111-8111-111111111111", channel_id: "22222222-2222-4222-8222-222222222222", created_by: "owner", title: "Drive tutorial", language: "en" };
function rows(values: unknown[]) { const promise = Promise.resolve(values); const q = { from: () => q, where: () => q, orderBy: () => q, limit: () => q, for: () => q, then: promise.then.bind(promise) }; mocks.select.mockReturnValueOnce(q); }
function request(extra = {}) { return POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ requestId: "33333333-3333-4333-8333-333333333333", top: "DRIVE", bottom: "SHARE FILES", ...extra }) }), { params: Promise.resolve({ id: job.id }) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "owner", role: "VA" }); mocks.connect.mockReturnValue({ quit: mocks.quit }); mocks.getJob.mockResolvedValue(null); mocks.insert.mockReturnValue({ values: mocks.values }); mocks.values.mockResolvedValue(undefined); mocks.readiness.mockResolvedValue({ provider: "configured", ready: null, reason: "mock" }); });
it("rejects another VA before queue access", async () => { rows([{ ...job, created_by: "other" }]); expect((await request()).status).toBe(403); expect(mocks.connect).not.toHaveBeenCalled(); });
it("fails actionably for a missing language", async () => { rows([{ ...job, language: null }]); expect((await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ id: job.id }) })).status).toBe(409); });
it("honors server manual mode even when a client asks for AI", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "manual" }]); expect((await request({ mode: "ai" })).status).toBe(409); expect(mocks.connect).not.toHaveBeenCalled(); });
it("blocks replacement generation after delivery starts", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "ai" }]); rows([{ id: job.id, uploaded: true }]); rows([]); expect((await request()).status).toBe(409); expect(mocks.connect).not.toHaveBeenCalled(); });
it("queues five server-owned manually selected candidates after durable intent", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "ai" }]); rows([{ id: job.id }]); rows([]); rows([]); rows([]); expect((await request({ subjectId: "spoof", channelId: "spoof", manualSelection: false })).status).toBe(202); expect(mocks.add).toHaveBeenCalledTimes(5); expect(mocks.add).toHaveBeenCalledWith("thumbnail", expect.objectContaining({ subjectId: job.id, channelId: job.channel_id, language: "en", format: "TUTORIAL_STUDIO", manualSelection: true, variantIndex: 4 }), expect.objectContaining({ attempts: 1 })); expect(mocks.values.mock.invocationCallOrder[0]).toBeLessThan(mocks.add.mock.invocationCallOrder[0]!); expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.quit).toHaveBeenCalledOnce(); });
it("does not queue known unavailable VeoForge", async () => { rows([job]); mocks.readiness.mockResolvedValue({ provider: "veoforge", ready: false, reason: "No ready accounts" }); expect((await request()).status).toBe(503); expect(mocks.connect).not.toHaveBeenCalled(); });
it("returns persisted unadmitted progress and unavailable reason without queue or provider execution", async () => {
  rows([job]); rows([{ mode: "ai" }]); rows([]);
  rows([{ requestId: "saved", attempted: [], payload: { count: 5 }, createdAt: new Date() }]); rows([]); rows([]);
  mocks.readiness.mockResolvedValue({ provider: "veoforge", ready: false, reason: "Admin must restore availability" });
  const response = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ id: job.id }) });
  expect(await response.json()).toMatchObject({ providerReadiness: { ready: false }, batchProgress: [{ requestId: "saved", count: 5, completed: 0 }], localization: [], localizationIdentityVerified: false });
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
});
it("does not expose old localized candidates without a verified current English source", async () => {
  rows([{ ...job, language: "de", source_job_id: "source" }]); rows([{ mode: "ai" }]); rows([]); rows([{ ...job, id: "source" }]); rows([]);
  rows([{ id: "old-locale", output: "/old.png", status: "completed" }]);
  const response = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ id: job.id }) });
  expect(await response.json()).toMatchObject({ candidates: [], localization: [], localizationIdentityVerified: false });
});
it("rejects changed inputs replaying an existing batch identity", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "ai" }]); rows([{ id: job.id }]); rows([]); rows([{ payload_digest: "different" }]); expect((await request()).status).toBe(409); expect(mocks.add).not.toHaveBeenCalled(); });
it("does not regenerate persisted variants when Redis history is gone", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "ai" }]); rows([{ id: job.id }]); rows([]); rows([]); rows([0,1,2,3,4].map(index => ({ index }))); expect((await request()).status).toBe(202); expect(mocks.add).not.toHaveBeenCalled(); });
it("a failed English row alone never authorizes another paid attempt", async () => { rows([job]); rows([job]); rows([job]); rows([{ thumbnail_generation_mode: "ai" }]); rows([{ id: job.id }]); rows([]); rows([{ status: "failed" }]); const response = await request({ retryThumbnailId: "44444444-4444-4444-8444-444444444444" }); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "ADMIN_RECONCILIATION_REQUIRED" }); expect(mocks.add).not.toHaveBeenCalled(); });
