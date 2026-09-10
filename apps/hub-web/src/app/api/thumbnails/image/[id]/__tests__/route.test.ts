import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), thumbnail: vi.fn(), access: vi.fn(), read: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/repositories/thumbnail-studio-repository", () => ({ getThumbnail: mocks.thumbnail }));
vi.mock("@/lib/tutorial/delivery-access", () => ({ mayAccessDelivery: mocks.access }));
vi.mock("@/lib/tutorial/media-access", () => ({ withTutorialAsset: async (request: {path:string}, consume: (path:string)=>Promise<unknown>) => consume(request.path) }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));
vi.mock("@/lib/db", () => ({ tutorialJobs: {}, db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }) } }));
const { GET } = await import("../route");
const request = () => GET(new Request("http://localhost") as never, { params: Promise.resolve({ id: "thumbnail" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
  mocks.permission.mockImplementation((_session, permission) => permission === "manage:thumbnails");
  mocks.thumbnail.mockResolvedValue({ subject_kind: "tutorial_job", subject_id: "job", output_path: "/private/thumb.jpg" });
  mocks.rows.mockResolvedValue([{ created_by: "owner", channel_id: "channel" }]);
  mocks.access.mockResolvedValue(false);
  mocks.read.mockResolvedValue(Buffer.from("image"));
});
it("does not read image bytes for another producer", async () => {
  expect((await request()).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("allows owner or explicitly assigned uploader access", async () => {
  mocks.access.mockResolvedValue(true);
  expect((await request()).status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith({ userId: "va", role: "TUTORIAL_VA" }, { created_by: "owner", channel_id: "channel" });
});
it("does not broaden a thumbnail grant to other content formats", async () => {
  mocks.thumbnail.mockResolvedValue({ subject_kind: "content_job", output_path: "/private/thumb.jpg" });
  expect((await request()).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
