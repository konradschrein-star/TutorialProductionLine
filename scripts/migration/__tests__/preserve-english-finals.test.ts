import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDriveOwner, exactFiveIds, EXPECTED_OWNER, parsePreservationManifest, PRESERVATION_VERSION, preserveOne, safeSessionUri, type PreservationPorts, type Receipt } from "../preserve-english-finals";
const ids = Array.from({ length: 5 }, (_, i) => `10000000-0000-4000-8000-00000000000${i}`);
const file = { jobId: ids[0]!, path: "/opt/content-forge/media/tutorial/example/final.mp4", sourceRevision: "a".repeat(64), completedAt: "2026-09-09T00:00:00Z", bytes: 10, sha256: "b".repeat(64), md5: "c".repeat(32), statToken: "stable" };
const uri = "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic";
function fixture() {
  const events: Receipt[] = [], calls: string[] = [];
  const ports: PreservationPorts = {
    recheck: async (_f, full) => { calls.push(full ? "hash" : "stat"); }, find: async () => null,
    start: async () => { assert.equal(events.at(-1)?.stage, "intent"); calls.push("create"); return uri; },
    offset: async () => 0, chunk: async () => { assert.equal(events.at(-1)?.stage, "session"); calls.push("chunk"); return { fileId: "verified-file-id" }; },
    verify: async () => { calls.push("readback"); }, append: async event => { events.push(event); },
  };
  return { events, calls, ports };
}
test("exact explicit five UUIDs, distinct paths and bounded identity are required", () => {
  assert.equal(exactFiveIds(ids).length, 5);
  for (const value of [[], ids.slice(1), [...ids, ids[0]], [ids[0], ...ids.slice(0, 4)], ["sql injection", ...ids.slice(1)]]) assert.throws(() => exactFiveIds(value));
  const manifest = { version: PRESERVATION_VERSION, expectedOwner: EXPECTED_OWNER, folderId: "destination-folder", createdAt: file.completedAt, entries: ids.map((id, i) => ({ ...file, jobId: id, path: `/opt/content-forge/media/tutorial/${i}/final.mp4` })) };
  assert.equal(parsePreservationManifest(manifest).entries.length, 5);
  assert.throws(() => parsePreservationManifest({ ...manifest, entries: manifest.entries.map(e => ({ ...e, path: "/tmp/unsafe" })) }));
});
test("owner, writable nonshared folder and verified capacity fail closed", () => {
  const about = { user: { emailAddress: EXPECTED_OWNER }, storageQuota: { limit: "1000000000", usage: "0" } };
  const folder = { mimeType: "application/vnd.google-apps.folder", ownedByMe: true, capabilities: { canAddChildren: true } };
  assert.doesNotThrow(() => assertDriveOwner(about, folder, 10));
  assert.throws(() => assertDriveOwner({ ...about, user: { emailAddress: "other@example.test" } }, folder, 10));
  assert.throws(() => assertDriveOwner(about, { ...folder, ownedByMe: false }, 10));
  assert.throws(() => assertDriveOwner({ ...about, storageQuota: {} }, folder, 10));
  assert.throws(() => assertDriveOwner(about, folder, 999999999));
});
test("intent and session are durable before bytes, remote readback and final source hash precede verified", async () => {
  const f = fixture(); await preserveOne(file, [], f.ports);
  assert.deepEqual(f.events.map(e => e.stage), ["intent", "session", "uploaded", "verified"]);
  assert.deepEqual(f.calls, ["hash", "create", "stat", "chunk", "readback", "hash"]);
});
test("verified repeat rechecks remote bytes without a second upload", async () => {
  const f = fixture(); await preserveOne(file, [{ jobId: file.jobId, stage: "verified", fileId: "exact-file" }], f.ports);
  assert.deepEqual(f.calls, ["hash", "readback", "hash"]);
});
test("lost create response is uncertain and never blindly recreated", async () => {
  const f = fixture(); await assert.rejects(preserveOne(file, [{ jobId: file.jobId, stage: "intent" }], f.ports), /reconciliation/);
  assert.ok(!f.calls.includes("create"));
});
test("persisted session resumes without another create", async () => {
  const f = fixture(); f.events.push({ jobId: file.jobId, stage: "session", sessionUri: uri }); await preserveOne(file, f.events, f.ports);
  assert.ok(!f.calls.includes("create")); assert.equal(f.events.at(-1)?.stage, "verified");
});
test("changed source or corrupt Drive bytes never records verification", async () => {
  for (const failure of ["recheck", "verify"] as const) {
    const f = fixture(); f.ports[failure] = async () => { throw new Error("changed"); };
    await assert.rejects(preserveOne(file, [], f.ports));
    assert.ok(!f.events.some(e => e.stage === "verified"));
  }
});
test("receipt session URI cannot send credentials to another host", () => {
  assert.equal(safeSessionUri(uri), uri);
  for (const value of ["https://evil.test/upload/drive/v3/files", "http://www.googleapis.com/upload/drive/v3/files", "https://user:pass@www.googleapis.com/upload/drive/v3/files", "https://www.googleapis.com/other"]) assert.throws(() => safeSessionUri(value));
});
test("failed durable intent stops before any remote creation", async () => {
  const f = fixture(); f.ports.append = async () => { throw new Error("disk full"); };
  await assert.rejects(preserveOne(file, [], f.ports), /disk full/);
  assert.ok(!f.calls.includes("create"));
});
test("source mutation after upload preserves object but never claims verification", async () => {
  const f = fixture(); let hashes = 0;
  f.ports.recheck = async (_file, full) => { if (full && ++hashes === 2) throw new Error("source changed"); };
  await assert.rejects(preserveOne(file, [], f.ports), /source changed/);
  assert.ok(f.events.some(row => row.stage === "uploaded"));
  assert.ok(!f.events.some(row => row.stage === "verified"));
});
test("unreasonable chunk acknowledgement fails closed", async () => {
  const f = fixture(); f.ports.chunk = async () => ({ nextOffset: 9999999 });
  await assert.rejects(preserveOne(file, [], f.ports), /offset/);
  assert.ok(!f.events.some(row => row.stage === "verified"));
});
