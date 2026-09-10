import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/tutorial/reserve-publication", () => ({ reserveCompletedTutorialSlots: async () => ({ reserved: [], outstanding: [] }) }));
vi.mock("@/lib/tutorial/capture-family-approval", () => ({ captureFamilyApproval: async (_tx: unknown, root: { id: string }) => ({ approvedIds: [root.id], unavailable: [] }) }));
vi.mock("@/lib/auth/rbac", () => ({
  hasPermission: (_: unknown, permission: string) => permission === "create:tutorial-job",
}));
vi.mock("@/lib/db", () => ({
  db: { transaction: (run: (tx: unknown) => unknown) => run({
    select: mocks.select,
    update: () => ({ set: mocks.set }),
  }) }, tutorialJobs: {}, tutorialUploadDispatches: {}, thumbnails: {},
}));
const { POST } = await import("../route");
const id = "11111111-1111-4111-8111-111111111111";
const original = { id, created_by: "va", status: "COMPLETED", final_path: "/media/final.mp4", source_job_id: null, va_review_status: null, title: "Title", description: "Description", tags: ["tutorial"], language: "en", channel_id: "channel" };
const thumbnail = { id: "thumb", language: "en", channelId: "channel", status: "completed", isSelected: true, outputPath: "/media/thumb.png" };
function rows(value: unknown[]) {
  const chain = { from: () => chain, where: () => chain, limit: () => chain, for: () => Promise.resolve(value), then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(value).then(resolve) };
  mocks.select.mockReturnValueOnce(chain);
}
function act(action = "disapprove", reason?: string) {
  return POST(new Request("https://studio.example/api/review", {
    method: "POST", body: JSON.stringify({ action, reason }),
  }) as never, { params: Promise.resolve({ id }) });
}
describe("recoverable final review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
    mocks.set.mockReturnValue({ where: () => Promise.resolve() });
  });
  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await act()).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("cannot review another producer's work", async () => {
    rows([{ ...original, created_by: "other" }]);
    expect((await act()).status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("returns a completed original to recording without clearing any asset references", async () => {
    rows([original]); rows([{ id, uploaded: false, uploaderStatus: null }]); rows([]);
    expect((await act("disapprove", "Record the missing final step")).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: "READY_TO_RECORD", va_review_status: "rework_requested", error_message: "Record the missing final step" }));
    const patch = mocks.set.mock.calls[0]![0];
    for (const key of ["final_path", "recording_path", "delivered_to_drive"]) expect(patch).not.toHaveProperty(key);
  });
  it("is idempotent when a rework response was lost", async () => {
    rows([{ ...original, status: "READY_TO_RECORD", va_review_status: "rework_requested" }]);
    expect((await act()).status).toBe(200);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("does not imply cancellation of an already dispatched locale", async () => {
    rows([original]); rows([{ id: "locale", uploaded: false, uploaderStatus: null }]); rows([{ id: "dispatch" }]);
    expect((await act()).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("does not approve unfinished work", async () => {
    rows([{ ...original, status: "SPLICING" }]);
    expect((await act("approve")).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("allows a VA to approve their own completed original", async () => {
    rows([original]); rows([thumbnail]);
    expect((await act("approve")).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ va_review_status: "approved", va_reviewed_by: "va" }));
  });
  it("does not approve or reserve a slot without a thumbnail", async () => {
    rows([original]); rows([]);
    const response = await act("approve");
    expect(response.status).toBe(409);
    expect((await response.json()).reasons.join(" ")).toContain("thumbnail");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("does not approve missing metadata even with a thumbnail", async () => {
    rows([{ ...original, description: " " }]); rows([thumbnail]);
    expect((await act("approve")).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
