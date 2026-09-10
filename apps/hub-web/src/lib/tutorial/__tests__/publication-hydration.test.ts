import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ media: vi.fn(), capture: vi.fn(), matches: vi.fn() }));
vi.mock("../media-access", () => ({ withPublicationMedia: mocks.media }));
vi.mock("@repo/media-core", () => ({ capturePublicationApproval: mocks.capture, publicationApprovalMatches: mocks.matches }));
vi.mock("../publication-readiness", () => ({ assessPublicationVariant: () => ({ ready: true, thumbnail: { id: "thumb", outputPath: "/media/thumb.jpg" } }) }));
const { verifyPublicationApproval } = await import("../verify-publication-approval");
const tx = { select: () => ({ from: () => ({ where: async () => [] }) }) };
const job = { id: "job", channel_id: "channel", language: "en", title: "Title", description: "Description", tags: ["tag"], final_path: "/media/video.mp4", publication_approval: { revision: "approved" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.media.mockImplementation(async (_job, _video, _thumb, work) => work());
  mocks.capture.mockResolvedValue({ revision: "approved" }); mocks.matches.mockReturnValue(true);
});
it("hashes publication assets inside their hydration and consumption leases without changing stored paths", async () => {
  await verifyPublicationApproval(tx as never, job as never, "source-revision");
  expect(mocks.media).toHaveBeenCalledWith("job", "/media/video.mp4", "/media/thumb.jpg", expect.any(Function), tx);
  expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ videoPath: "/media/video.mp4", thumbnailPath: "/media/thumb.jpg", sourceRevision: "source-revision" }));
});
it("fails review verification when no trustworthy bytes can be hydrated", async () => {
  mocks.media.mockRejectedValue(new Error("no verified archive"));
  await expect(verifyPublicationApproval(tx as never, job as never, "source")).rejects.toThrow("no verified archive");
  expect(mocks.capture).not.toHaveBeenCalled();
});
it("continues rejecting a different restored revision after hydration", async () => {
  mocks.matches.mockReturnValue(false);
  await expect(verifyPublicationApproval(tx as never, job as never, "source")).rejects.toThrow("changed after approval");
});
