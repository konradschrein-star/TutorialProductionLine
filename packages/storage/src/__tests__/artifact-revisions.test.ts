import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { DrizzleClient, StorageArtifact } from "@repo/db";
import type { DriveClient } from "../drive/client.js";
import { fakeDriveConfig } from "./fake-drive.js";

const mocks = vi.hoisted(() => ({ previous: vi.fn(), ensure: vi.fn(), archive: vi.fn(), revision: vi.fn(), uploaded: vi.fn(), failed: vi.fn(), skipped: vi.fn(), progress: vi.fn(), resumable: vi.fn() }));
vi.mock("../repository.js", () => ({ getArtifact: mocks.previous, ensureArtifactRow: mocks.ensure, archiveArtifactVersion: mocks.archive, recordSourceRevision: mocks.revision, markUploaded: mocks.uploaded, markFailed: mocks.failed, markSkipped: mocks.skipped, recordProgress: mocks.progress, markUploading: vi.fn(), markBudgetDeferred: vi.fn(), getArtifactById: vi.fn(), markDeletedFromDrive: vi.fn() }));
vi.mock("../daily-budget.js", () => ({ checkBudget: async () => ({ allowed: true }), recordUsage: vi.fn() }));
vi.mock("../drive/resumable-upload.js", () => ({ resumableUpload: mocks.resumable }));
const { ArtifactStore } = await import("../artifact-store.js");
let directory: string; let path: string; let source: Buffer; let previous: StorageArtifact;
const digest = (algorithm: string, value: Buffer) => createHash(algorithm).update(value).digest("hex");
let drive: { getFile: ReturnType<typeof vi.fn>; findExistingArtifact: ReturnType<typeof vi.fn>; ensureFolderPath: ReturnType<typeof vi.fn>; uploadSmallFile: ReturnType<typeof vi.fn>; updateSmallFile: ReturnType<typeof vi.fn>; deleteFile: ReturnType<typeof vi.fn>; inspectFileContent: ReturnType<typeof vi.fn> };
function put() {
  const result = ArtifactStore.create({} as DrizzleClient, { config: fakeDriveConfig(), driveClient: drive as unknown as DriveClient });
  if (!result.ok) throw new Error(result.reason);
  return result.store.putFinalArtifact({ jobId: "job", kind: "thumbnail", localPath: path, channelId: null, channelName: "Channel", title: "Title", completedAt: new Date(), computeChecksum: false });
}
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "storage-revision-test-")); path = join(directory, "thumbnail.jpg");
  source = Buffer.from("NEW_IMAGE"); await writeFile(path, source);
  previous = { id: "artifact", job_id: "job", kind: "thumbnail", vps_path: path, state: "uploaded", drive_file_id: "old", checksum_sha256: digest("sha256", Buffer.from("OLD_IMAGE")), bytes: source.length, drive_md5: digest("md5", Buffer.from("OLD_IMAGE")), resumable_session_uri: "old-session" } as StorageArtifact;
  mocks.previous.mockImplementation(async () => previous);
  mocks.ensure.mockImplementation(async () => ({ ...previous, vps_path: path }));
  drive = { getFile: vi.fn().mockResolvedValue({ ok: true, value: { id: "old", name: "thumbnail.jpg", size: String(source.length), md5Checksum: previous.drive_md5 } }),
    findExistingArtifact: vi.fn().mockResolvedValue({ ok: true, value: null }), ensureFolderPath: vi.fn().mockResolvedValue({ ok: true, value: "folder" }),
    uploadSmallFile: vi.fn().mockResolvedValue({ ok: true, value: { id: "new", name: "thumbnail.jpg", size: String(source.length), md5Checksum: digest("md5", source) } }),
    updateSmallFile: vi.fn(), deleteFile: vi.fn(), inspectFileContent: vi.fn(),
  };
});
afterEach(async () => { if (!directory.startsWith(join(tmpdir(), "storage-revision-test-"))) throw new Error("Unexpected test directory"); await rm(directory, { recursive: true, force: true }); });
it("same size and uploaded DB state cannot reuse stale Drive bytes", async () => {
  const result = await put();
  expect(result.outcome).toBe("uploaded");
  expect(drive.getFile).toHaveBeenCalledWith("old");
  expect(drive.uploadSmallFile).toHaveBeenCalledWith(expect.objectContaining({ sourceSha256: digest("sha256", source) }));
  expect(mocks.archive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ drive_file_id: "old" }));
  expect(mocks.uploaded).toHaveBeenCalledWith(expect.anything(), "artifact", expect.objectContaining({ drive_file_id: "new", checksum_sha256: digest("sha256", source), verified: true }));
  expect(drive.updateSmallFile).not.toHaveBeenCalled(); expect(drive.deleteFile).not.toHaveBeenCalled();
});
it("reuses only remotely checksum-matching current bytes", async () => {
  drive.getFile.mockResolvedValue({ ok: true, value: { id: "old", size: String(source.length), sha256Checksum: digest("sha256", source) } });
  expect((await put()).outcome).toBe("already_uploaded");
  expect(drive.uploadSmallFile).not.toHaveBeenCalled();
  expect(mocks.uploaded).toHaveBeenCalledWith(expect.anything(), "artifact", expect.objectContaining({ checksum_sha256: digest("sha256", source), verified: true }));
});
it("remote outage cannot silently trust an uploaded row", async () => {
  drive.getFile.mockResolvedValue({ ok: false, error: { kind: "network", message: "offline" } });
  expect((await put()).outcome).toBe("failed");
  expect(mocks.uploaded).not.toHaveBeenCalled(); expect(drive.deleteFile).not.toHaveBeenCalled();
});
it("a corrupt replacement never deletes the old object or advances its pointer", async () => {
  drive.uploadSmallFile.mockResolvedValue({ ok: true, value: { id: "new", size: String(source.length), md5Checksum: "bad" } });
  expect((await put()).outcome).toBe("failed");
  expect(mocks.uploaded).not.toHaveBeenCalled(); expect(drive.deleteFile).not.toHaveBeenCalled();
});
it("source replacement during upload is rejected even if uploaded bytes match the earlier snapshot", async () => {
  drive.uploadSmallFile.mockImplementation(async () => { await writeFile(path, Buffer.from("REPLACED!")); return { ok: true, value: { id: "new", size: String(source.length), md5Checksum: digest("md5", source) } }; });
  expect((await put()).outcome).toBe("failed");
  expect(mocks.uploaded).not.toHaveBeenCalled(); expect(drive.deleteFile).not.toHaveBeenCalled();
});
it("missing source bytes cannot be claimed as already uploaded", async () => {
  path = join(directory, "missing.jpg");
  expect((await put()).outcome).toBe("skipped");
  expect(mocks.uploaded).not.toHaveBeenCalled(); expect(drive.uploadSmallFile).not.toHaveBeenCalled();
});
it("discarded resumable identity cannot mix old prefix with new source bytes", async () => {
  source = Buffer.alloc(6 * 1024 * 1024, 7); await writeFile(path, source);
  mocks.resumable.mockResolvedValue({ ok: true, value: { id: "new", size: String(source.length), md5Checksum: digest("md5", source) } });
  expect((await put()).outcome).toBe("uploaded");
  expect(mocks.resumable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionUri: undefined, sourceSha256: digest("sha256", source) }), expect.anything(), expect.anything());
  expect(mocks.revision).toHaveBeenCalledWith(expect.anything(), "artifact", expect.objectContaining({ preserveSession: false }));
});
it("a relocated but identical source does not reuse an old resumable session", async () => {
  source = Buffer.alloc(6 * 1024 * 1024, 7); await writeFile(path, source);
  previous = { ...previous, bytes: source.length, checksum_sha256: digest("sha256", source), vps_path: join(directory, "old-location.mp4") };
  mocks.resumable.mockResolvedValue({ ok: true, value: { id: "new", size: String(source.length), md5Checksum: digest("md5", source) } });
  expect((await put()).outcome).toBe("uploaded");
  expect(mocks.resumable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionUri: undefined }), expect.anything(), expect.anything());
});
it("recovers an exact new revision after a lost pointer commit", async () => {
  drive.findExistingArtifact.mockResolvedValue({ ok: true, value: { id: "new", size: String(source.length), md5Checksum: digest("md5", source) } });
  expect((await put()).outcome).toBe("already_uploaded");
  expect(mocks.uploaded).toHaveBeenCalledWith(expect.anything(), "artifact", expect.objectContaining({ drive_file_id: "new" }));
  expect(drive.uploadSmallFile).not.toHaveBeenCalled();
});
it("requires streamed SHA-256 verification when Drive omits upload checksums", async () => {
  drive.uploadSmallFile.mockResolvedValue({ ok: true, value: { id: "new", size: String(source.length) } });
  drive.inspectFileContent.mockResolvedValue({ ok: true, value: { sizeBytes: source.length, sha256: digest("sha256", source) } });
  expect((await put()).outcome).toBe("uploaded");
  expect(drive.inspectFileContent).toHaveBeenCalledWith("new", source.length);
  expect(drive.deleteFile).not.toHaveBeenCalled();
});
