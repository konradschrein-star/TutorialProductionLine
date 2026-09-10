import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DrizzleClient } from "@repo/db";
import { withTutorialMedia, withTutorialMediaSet, openLeasedMediaStream, parseMediaByteRange, createDatabaseMediaLease, type TutorialMediaOptions } from "../tutorial-media.js";
import * as runtimeConfig from "../runtime-config.js";

let root: string, path: string, options: TutorialMediaOptions;
let rows: unknown[], query: unknown, active: boolean;
const bytes = Buffer.from("durable tutorial");
let db: DrizzleClient;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tutorial-media-test-")); path = join(root, "video.mp4"); active = false;
  rows = [{ drive_file_id: "exact", verified_at: new Date(), checksum_sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }];
  db = { select: () => ({ from: () => ({ where: (sql: unknown) => { query = sql; return { limit: async () => rows }; } }) }) } as unknown as DrizzleClient;
  options = { allowedRoots: [root], maxBytes: 1024, withLease: async (_key, work) => { active = true; try { return await work(); } finally { active = false; } }, streamFileContent: vi.fn(async function* () { yield bytes; }) };
});
afterEach(async () => {
  if (!root.startsWith(join(tmpdir(), "tutorial-media-test-"))) throw new Error("Invalid fixture root");
  await rm(root, { recursive: true, force: true });
});
const use = <T>(consume: (path: string) => Promise<T>) => withTutorialMedia(db, { jobId: "job", kind: "final_video", path }, options, consume);
it("keeps current unarchived local bytes usable without archive lookup", async () => {
  await writeFile(path, "current draft"); rows = [];
  expect(await use(async (value) => { expect(active).toBe(true); return readFile(value, "utf8"); })).toBe("current draft");
  expect(options.streamFileContent).not.toHaveBeenCalled();
});
it("restores only an uploaded exact owner/job/kind/path match with verified immutable evidence", async () => {
  expect(await use(async (value) => readFile(value))).toEqual(bytes);
  const sql = new PgDialect().sqlToQuery(query as never);
  expect(sql.params).toEqual(["tutorial_job", "job", "final_video", path, "uploaded"]);
  expect(options.streamFileContent).toHaveBeenCalledWith("exact", bytes.length);
});
it.each(["missing", "unverified", "hash", "ambiguous"])("rejects %s archive evidence", async (mode) => {
  if (mode === "missing") rows = [];
  if (mode === "unverified") rows = [{ ...rows[0] as object, verified_at: null }];
  if (mode === "hash") rows = [{ ...rows[0] as object, checksum_sha256: null }];
  if (mode === "ambiguous") rows.push(rows[0]);
  await expect(use(async () => undefined)).rejects.toThrow("no exact verified");
  expect(options.streamFileContent).not.toHaveBeenCalled();
});
it("holds HTTP lease after response preparation until actual consumption completes", async () => {
  await writeFile(path, bytes);
  const media = await openLeasedMediaStream((consume) => use(consume));
  expect(active).toBe(true);
  expect(await new Response(media.stream).text()).toBe(bytes.toString());
  await vi.waitFor(() => expect(active).toBe(false));
});
it("releases HTTP lease when the response is cancelled without reading", async () => {
  await writeFile(path, bytes);
  const media = await openLeasedMediaStream((consume) => use(consume));
  expect(active).toBe(true);
  await media.stream.cancel();
  await vi.waitFor(() => expect(active).toBe(false));
});
it("rolls lease lifecycle back when hydration fails before a response exists", async () => {
  rows = [];
  await expect(openLeasedMediaStream((consume) => use(consume))).rejects.toThrow("no exact verified");
  expect(active).toBe(false);
});
it("releases the HTTP lease after a readable error", async () => {
  const media = await openLeasedMediaStream(async (consume) => {
    active = true;
    try { await consume(root); } finally { active = false; }
  });
  await expect(new Response(media.stream).arrayBuffer()).rejects.toThrow();
  await vi.waitFor(() => expect(active).toBe(false));
});
it("rechecks approved bytes under the active stream lease", async () => {
  await writeFile(path, "newer unapproved bytes");
  await expect(withTutorialMedia(db, { jobId: "job", kind: "final_video", path, expectedContent: { sha256: "a".repeat(64), size: 22 } }, options, async () => undefined)).rejects.toThrow("differs from approved");
  expect(options.streamFileContent).not.toHaveBeenCalled();
});
it("acquires its advisory lock through the same pinned transaction callback", async () => {
  const order: string[] = [];
  const pinned = { execute: async (sql: unknown) => { const text = new PgDialect().sqlToQuery(sql as never); expect(text.sql).toContain("pg_advisory_xact_lock"); expect(text.params).toEqual([`tutorial-media:${path}`]); order.push("lock"); } };
  const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => { order.push("begin"); try { return await callback(pinned); } finally { order.push("end"); } } } as unknown as DrizzleClient;
  await createDatabaseMediaLease(database)(path, async () => { order.push("consume"); });
  expect(order).toEqual(["begin", "lock", "consume", "end"]);
});
it("finishes ten concurrent missing-file requests through a bounded one-connection pool without reentry", async () => {
  let tail = Promise.resolve(), held = 0, peak = 0, transactions = 0;
  const globalSelect = vi.fn(() => { throw new Error("Pool reentry while its only connection is held"); });
  const pinnedSelect = db.select;
  const pool = { select: globalSelect, transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const prior = tail; let release!: () => void; tail = new Promise<void>(done => { release = done; });
    await prior; held++; peak = Math.max(peak, held); transactions++;
    try { return await work({ select: pinnedSelect, execute: async () => undefined }); }
    finally { held--; release(); }
  } } as unknown as DrizzleClient;
  const { withLease: _fake, ...defaultOptions } = options;
  await Promise.all(Array.from({ length: 10 }, (_, index) => withTutorialMedia(pool, { jobId: `job-${index}`, kind: "final_video", path: join(root, `video-${index}.mp4`) }, defaultOptions, async value => expect(await readFile(value)).toEqual(bytes))));
  expect(transactions).toBe(10); expect(peak).toBe(1); expect(globalSelect).not.toHaveBeenCalled();
}, 3000);
it("locks a multi-asset approval in sorted order on the caller's transaction without opening another", async () => {
  const thumbnail = join(root, "a-thumb.jpg"); await writeFile(path, bytes); await writeFile(thumbnail, bytes);
  const keys: unknown[] = [];
  const transaction = { execute: async (query: unknown) => { keys.push(new PgDialect().sqlToQuery(query as never).params[0]); }, select: db.select };
  const transactionFactory = vi.fn(() => { throw new Error("Nested connection acquisition"); });
  const pool = { transaction: transactionFactory } as unknown as DrizzleClient;
  const { withLease: _fake, ...defaultOptions } = options;
  await withTutorialMediaSet(pool, [{ jobId: "job", kind: "final_video", path }, { jobId: "job", kind: "thumbnail", path: thumbnail }], { ...defaultOptions, transaction: transaction as never }, async values => expect(values).toEqual([path, thumbnail]));
  expect(keys).toEqual([`tutorial-media:${thumbnail}`, `tutorial-media:${path}`]); expect(transactionFactory).not.toHaveBeenCalled();
});
it("loads Drive configuration using the same pinned transaction", async () => {
  const transaction = { execute: async () => undefined, select: db.select };
  const config = vi.spyOn(runtimeConfig, "loadStorageConfigFromDatabase").mockResolvedValue({ enabled: false, reason: "not configured" });
  const { withLease: _fake, streamFileContent: _stream, ...defaultOptions } = options;
  try {
    await expect(withTutorialMedia(db, { jobId: "job", kind: "final_video", path }, { ...defaultOptions, transaction: transaction as never }, async () => undefined)).rejects.toThrow("not configured");
    expect(config).toHaveBeenCalledWith(transaction);
  } finally { config.mockRestore(); }
});
it("propagates consumer ENOENT without treating another missing input as a hydration request", async () => {
  await writeFile(path, bytes);
  const spy = vi.spyOn(db, "select");
  const error = Object.assign(new Error("missing unrelated subtitle"), { code: "ENOENT" });
  await expect(use(async () => { throw error; })).rejects.toBe(error);
  expect(spy).not.toHaveBeenCalled(); expect(options.streamFileContent).not.toHaveBeenCalled();
});
it("never substitutes an archived video for missing local-only narration", async () => {
  const spy = vi.spyOn(db, "select");
  await expect(withTutorialMedia(db, { jobId: "child", kind: null, path }, options, async () => undefined)).rejects.toThrow("Restore the original narration/audio");
  expect(spy).not.toHaveBeenCalled(); expect(options.streamFileContent).not.toHaveBeenCalled();
});
it.each([
  ["bytes=2-4", {start:2,end:4}], ["bytes=2-", {start:2,end:9}], ["bytes=-3", {start:7,end:9}], ["bytes=-99", {start:0,end:9}], ["bytes=2-99", {start:2,end:9}],
  ["bytes=10-", "invalid"], ["bytes=5-2", "invalid"], ["bytes=-0", "invalid"], ["bytes=", "invalid"], ["bytes=0-1,3-4", "invalid"], ["bytes=9999999999999999999-", "invalid"],
])("validates single byte range %s", (header, expected) => { expect(parseMediaByteRange(header as string, 10)).toEqual(expected); });
it("reads only the requested byte interval while retaining the response lease", async () => {
  await writeFile(path, bytes);
  const media = await openLeasedMediaStream(consume => use(consume), {range:"bytes=2-5"});
  expect(active).toBe(true); expect(media.status).toBe(206); expect(media.contentLength).toBe(4); expect(media.contentRange).toBe(`bytes 2-5/${bytes.length}`);
  expect(await new Response(media.stream).text()).toBe(bytes.subarray(2,6).toString());
  await vi.waitFor(()=>expect(active).toBe(false));
});
it("returns 416 and releases without starting a file stream for invalid ranges", async () => {
  await writeFile(path, bytes);
  const media = await openLeasedMediaStream(consume => use(consume), {range:"bytes=999-"});
  expect(media.status).toBe(416); expect(media.contentRange).toBe(`bytes */${bytes.length}`); expect(await new Response(media.stream).text()).toBe("");
  await vi.waitFor(()=>expect(active).toBe(false));
});
it("revalidates audio validators under the lease and releases immediately for304", async () => {
  await writeFile(path, bytes);
  const initial=await openLeasedMediaStream(consume=>use(consume));
  await initial.stream.cancel();await vi.waitFor(()=>expect(active).toBe(false));
  const fresh=await openLeasedMediaStream(consume=>use(consume),{ifNoneMatch:`W/${initial.etag}`});
  expect(fresh.status).toBe(304);expect(fresh.etag).toBe(initial.etag);expect(fresh.lastModified).toBe(initial.lastModified);
  await vi.waitFor(()=>expect(active).toBe(false));
});
