import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, readFile, stat, utimes, link, rename, rm, symlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { evictVerifiedTutorialCache, createDatabaseCacheEvictionPorts, type CacheCandidate, type CacheSnapshot, type CacheEvictionOptions, type CacheEvictionPorts } from "../verified-cache-eviction.js";
import type { DrizzleClient } from "@repo/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DriveFile } from "../drive/client.js";

let root: string, bytes: Buffer, candidate: CacheCandidate, snapshot: CacheSnapshot, remote: DriveFile;
let options: CacheEvictionOptions, ports: CacheEvictionPorts;
let beforeRemote: (() => Promise<void>) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "verified-cache-eviction-test-"));
  bytes = Buffer.from("the only verified completed tutorial bytes");
  candidate = { jobId: "test-job", kind: "final_video", path: join(root, "final.mp4") };
  const now = Date.now(), old = new Date(now - 72 * 3600000);
  await writeFile(candidate.path, bytes); await utimes(candidate.path, old, old);
  const sha = createHash("sha256").update(bytes).digest("hex");
  snapshot = { jobId: candidate.jobId, status: "COMPLETED", completedAt: old, currentPath: candidate.path,
    receipt: { ownerKind: "tutorial_job", jobId: candidate.jobId, kind: "final_video", path: candidate.path,
      state: "uploaded", sha256: sha, size: bytes.length, verifiedAt: old, driveId: "verified-drive-id" } };
  remote = { id: "verified-drive-id", name: "final.mp4", size: String(bytes.length), sha256Checksum: sha, trashed: false };
  options = { allowedRoots: [root], serviceOwnedRoots: true, maxBytes: 4096, now,
    env: { TUTORIAL_VERIFIED_CACHE_EVICTION_ENABLED: "true" } };
  beforeRemote = undefined;
  ports = { tryLease: vi.fn(async (_path, _candidate, work) => work({
    snapshot: async () => structuredClone(snapshot),
    remote: async () => { await beforeRemote?.(); return remote; },
  })) };
});
afterEach(async () => {
  // Test-owned exact temporary directory only; never a configured media root.
  if (!resolve(root).startsWith(resolve(join(tmpdir(), "verified-cache-eviction-test-")))) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
});
const run = () => evictVerifiedTutorialCache(candidate, ports, options);
const remains = async () => expect(await readFile(candidate.path)).toEqual(bytes);
it("does nothing without the NEW explicit opt-in, even with legacy retention enabled", async () => {
  options.env = { TUTORIAL_RETENTION_ENABLED: "true" };
  expect((await run()).reason).toBe("disabled"); expect(ports.tryLease).not.toHaveBeenCalled(); await remains();
});
it("evicts only exact verified final bytes and preserves neighboring files", async () => {
  await writeFile(join(root, "unrelated.bin"), "keep");
  const result = await run();
  expect(result).toEqual({ outcome: "evicted", reason: "exact-remote-revision-verified", bytesFreed: bytes.length });
  await expect(stat(candidate.path)).rejects.toHaveProperty("code", "ENOENT");
  expect(await readFile(join(root, "unrelated.bin"), "utf8")).toBe("keep");
});
it("can verify fresh remote MD5 when SHA256 is absent", async () => {
  delete remote.sha256Checksum; remote.md5Checksum = createHash("md5").update(bytes).digest("hex");
  expect((await run()).outcome).toBe("evicted");
});
it.each(["raw_recording", "thumbnail", "metadata"])("never enables uncertified kind %s", async kind => {
  candidate.kind = kind; expect((await run()).reason).toBe("consumer-restore-not-certified"); await remains();
});
it.each(["FAILED_RENDER", "READY_TO_RECORD", "PENDING", "RENDERING"])("retains non-completed %s work", async status => {
  snapshot.status = status; expect((await run()).outcome).toBe("retained"); await remains();
});
it("retains young completed work", async () => {
  snapshot.completedAt = new Date(); expect((await run()).outcome).toBe("retained"); await remains();
});
it("retains recently rehydrated bytes even on an old completed job", async () => {
  await utimes(candidate.path, new Date(), new Date()); expect((await run()).outcome).toBe("retained"); await remains();
});
it.each(["owner", "job", "kind", "path", "sha", "size", "verified", "drive", "state"])("retains mismatched receipt %s", async field => {
  const r = snapshot.receipt!;
  if (field === "owner") r.ownerKind = "content_job";
  if (field === "job") r.jobId = "other";
  if (field === "kind") r.kind = "raw_recording";
  if (field === "path") r.path += ".old";
  if (field === "sha") r.sha256 = "0".repeat(64);
  if (field === "size") r.size = bytes.length + 1;
  if (field === "verified") r.verifiedAt = null;
  if (field === "drive") r.driveId = null;
  if (field === "state") r.state = "pending";
  expect((await run()).outcome).toBe("retained"); await remains();
});
it("retains missing archive receipt", async () => {
  snapshot.receipt = null; expect((await run()).outcome).toBe("retained"); await remains();
});
it.each(["wrong-id", "trashed", "unknown-trash", "size", "hash", "no-hash"])("retains unverified remote %s", async problem => {
  if (problem === "wrong-id") remote.id = "wrong";
  if (problem === "trashed") remote.trashed = true;
  if (problem === "unknown-trash") delete remote.trashed;
  if (problem === "size") remote.size = "999";
  if (problem === "hash") remote.sha256Checksum = "0".repeat(64);
  if (problem === "no-hash") delete remote.sha256Checksum;
  expect((await run()).outcome).toBe("retained"); await remains();
});
it("retains remote missing/outage, never uploads a replacement", async () => {
  beforeRemote = async () => { throw new Error("remote not found"); };
  expect((await run()).outcome).toBe("retained"); await remains();
});
it("skips a held lease immediately without touching media", async () => {
  ports.tryLease = async () => null;
  expect((await run()).reason).toBe("active-consumer-or-row-lock"); await remains();
});
it("retains bytes changed while remote verification runs", async () => {
  beforeRemote = async () => { await writeFile(candidate.path, Buffer.alloc(bytes.length, 120)); };
  expect((await run()).outcome).toBe("retained"); expect((await stat(candidate.path)).size).toBe(bytes.length);
});
it("retains inode replacement race", async () => {
  beforeRemote = async () => {
    await rename(candidate.path, join(root, "original.mp4"));
    await writeFile(candidate.path, bytes);
  };
  expect((await run()).outcome).toBe("retained"); await remains();
  expect(await readFile(join(root, "original.mp4"))).toEqual(bytes);
});
it("retains status or receipt changes on the final row recheck", async () => {
  beforeRemote = async () => { snapshot.status = "READY_TO_RECORD"; };
  expect((await run()).reason).toBe("job-or-receipt-changed"); await remains();
});
it("retains hard-linked files", async () => {
  await link(candidate.path, join(root, "second.mp4"));
  expect((await run()).outcome).toBe("retained"); await remains();
});
it("rejects a root itself and traversal without an unlink", async () => {
  candidate.path = root;
  expect((await run()).outcome).toBe("retained");
  candidate.path = join(root, "nested") + "/../final.mp4";
  expect((await run()).outcome).toBe("retained");
  expect(await readFile(join(root, "final.mp4"))).toEqual(bytes);
});
it("rejects symlink/junction ancestors", async () => {
  const actual = join(root, "actual"), alias = join(root, "alias");
  await mkdir(actual); await writeFile(join(actual, "media.mp4"), bytes);
  await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
  candidate.path = join(alias, "media.mp4");
  expect((await run()).outcome).toBe("retained");
  expect(await readFile(join(actual, "media.mp4"))).toEqual(bytes);
});
it("database adapter uses the identical canonical-path TRY lock and never enters work when held", async () => {
  const execute = vi.fn(async () => [{ acquired: false }]);
  const select = vi.fn(), work = vi.fn();
  const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute, select }) } as unknown as DrizzleClient;
  expect(await createDatabaseCacheEvictionPorts(db).tryLease(candidate.path, candidate, work)).toBeNull();
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never);
  expect(query.sql).toContain("pg_try_advisory_xact_lock");
  expect(query.params).toEqual([`tutorial-media:${candidate.path}`]);
  expect(select).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled();
});
it("database adapter rechecks job and receipt with nonwaiting row locks on the pinned transaction", async () => {
  const execute = vi.fn(async () => [{ acquired: true }]);
  let count = 0;
  const rowLock = vi.fn(async () => ++count % 2 === 1
    ? [{ id: candidate.jobId, status: "COMPLETED", completed_at: snapshot.completedAt, final_path: candidate.path }]
    : []);
  const chain = { from: () => chain, where: () => chain, limit: () => chain, for: rowLock };
  const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute, select: () => chain }) } as unknown as DrizzleClient;
  await createDatabaseCacheEvictionPorts(db).tryLease(candidate.path, candidate, async context => {
    expect((await context.snapshot())?.receipt).toBeNull();
    expect((await context.snapshot())?.jobId).toBe(candidate.jobId);
  });
  expect(rowLock).toHaveBeenCalledTimes(4);
  for (const args of rowLock.mock.calls) expect(args).toEqual(["update", { skipLocked: true }]);
});
