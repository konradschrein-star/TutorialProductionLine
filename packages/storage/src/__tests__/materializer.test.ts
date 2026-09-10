import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { withMaterializedArtifact, type ImmutableDriveRevision, type MaterializerPorts } from "../materializer.js";

let root: string;
let bytes: Buffer;
let revision: ImmutableDriveRevision;
let ports: MaterializerPorts;
let leased: boolean;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "drive-materializer-test-"));
  bytes = Buffer.from("verified immutable media");
  revision = { driveFileId: "exact-id", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, targetPath: join(root, "recording.mp4") };
  leased = false;
  ports = { allowedRoots: [root], maxBytes: 1024, streamFileContent: vi.fn(async function* () { yield bytes.subarray(0, 4); yield bytes.subarray(4); }), withLease: async (_key, work) => { leased = true; try { return await work(); } finally { leased = false; } } };
});
afterEach(async () => {
  if (!root.startsWith(join(tmpdir(), "drive-materializer-test-"))) throw new Error("Unexpected test directory");
  await rm(root, { recursive: true, force: true });
});
it("streams, verifies and atomically restores the original path under the consumption lease", async () => {
  await withMaterializedArtifact(revision, ports, async (path) => {
    expect(path).toBe(revision.targetPath); expect(leased).toBe(true);
    expect(await readFile(path)).toEqual(bytes);
  });
  expect(leased).toBe(false);
  expect(await readdir(root)).toEqual(["recording.mp4"]);
  expect(ports.streamFileContent).toHaveBeenCalledWith("exact-id", bytes.length);
});
it("reuses verified existing bytes without a Drive read", async () => {
  await writeFile(revision.targetPath, bytes);
  await withMaterializedArtifact(revision, ports, async () => undefined);
  expect(ports.streamFileContent).not.toHaveBeenCalled();
});
it("retains mismatching existing bytes and never downloads over them", async () => {
  await writeFile(revision.targetPath, "newer media");
  await expect(withMaterializedArtifact(revision, ports, async () => undefined)).rejects.toThrow("retained without overwrite");
  expect(await readFile(revision.targetPath, "utf8")).toBe("newer media");
  expect(ports.streamFileContent).not.toHaveBeenCalled();
});
it.each(["hash", "short", "large", "network"])("rejects %s failures and removes only its partial", async (mode) => {
  await writeFile(join(root, "unrelated.partial"), "retain");
  ports.streamFileContent = async function* () {
    yield mode === "hash" ? Buffer.alloc(bytes.length) : mode === "short" ? bytes.subarray(1) : mode === "large" ? Buffer.concat([bytes, bytes]) : bytes.subarray(0, 1);
    if (mode === "network") throw new Error("offline");
  };
  await expect(withMaterializedArtifact(revision, ports, async () => undefined)).rejects.toThrow();
  expect(await readdir(root)).toEqual(["unrelated.partial"]);
  expect(leased).toBe(false);
});
it("never clobbers a competing newly created destination", async () => {
  ports.streamFileContent = async function* () { yield bytes; await writeFile(revision.targetPath, "newer revision"); };
  await expect(withMaterializedArtifact(revision, ports, async () => undefined)).rejects.toThrow("retained without overwrite");
  expect(await readFile(revision.targetPath, "utf8")).toBe("newer revision");
  expect(await readdir(root)).toEqual(["recording.mp4"]);
});
it("shares a process hydration promise for concurrent identical requests", async () => {
  ports.withLease = async (_key, work) => work(); // fake external lock, specifically exercise process deduplication
  await Promise.all([1, 2, 3].map(() => withMaterializedArtifact(revision, ports, async (path) => expect(await readFile(path)).toEqual(bytes))));
  expect(ports.streamFileContent).toHaveBeenCalledTimes(1);
});
it.each(["traversal", "outside", "no-parent", "digest", "size", "lease"])("rejects invalid %s inputs", async (mode) => {
  if (mode === "traversal") revision.targetPath = `${root}/../outside.mp4`;
  if (mode === "outside") revision.targetPath = join(tmpdir(), "outside.mp4");
  if (mode === "no-parent") revision.targetPath = join(root, "missing-parent", "video.mp4");
  if (mode === "digest") revision.sha256 = "unknown";
  if (mode === "size") revision.sizeBytes = 2048;
  if (mode === "lease") ports.withLease = undefined as never;
  await expect(withMaterializedArtifact(revision, ports, async () => undefined)).rejects.toThrow();
  expect(ports.streamFileContent).not.toHaveBeenCalled();
});
it("rejects symlinked parent directories", async () => {
  // Junctions work without elevated symlink privileges on Windows.
  await symlink(root, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  revision.targetPath = join(root, "linked", "video.mp4");
  await expect(withMaterializedArtifact(revision, ports, async () => undefined)).rejects.toThrow("link");
  expect(ports.streamFileContent).not.toHaveBeenCalled();
});
it("releases the consumer lease on callback errors without deleting verified media", async () => {
  await expect(withMaterializedArtifact(revision, ports, async () => { throw new Error("consumer failed"); })).rejects.toThrow("consumer failed");
  expect(leased).toBe(false); expect(await readFile(revision.targetPath)).toEqual(bytes);
});
