import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { englishThumbnailApprovalRevision } from "@repo/db";
import { approvedReferenceDataUrl, assertEnglishThumbnailSource, runEnglishThumbnailFanout, type FanoutPorts } from "../english-thumbnail-fanout.js";
import { automaticEnglishBatch, enqueueSavedEnglishBatch, enqueueAutomaticEnglishThumbnails } from "../automatic-english-thumbnails.js";

const bytes = Buffer.from([255,216,255,224,1,2,3,4]);
const fingerprint = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
const source = { id: "11111111-1111-4111-8111-111111111111", source_job_id: null, parent_job_id: null, language: "en", channel_id: "22222222-2222-4222-8222-222222222222", status: "READY_TO_RECORD", va_review_status: null, title: "Settings", script_text: "A scripted tutorial", thumbnail_text_top: "SETTINGS", thumbnail_text_bottom: "GET STARTED" };
const image = { id: "33333333-3333-4333-8333-333333333333", output_path: "/media/master.jpg", status: "completed", channel_id: source.channel_id, review_verdict: "acceptable" };
const intent = { id: "44444444-4444-4444-8444-444444444444", source_job_id: source.id, source_thumbnail_id: image.id, source_path: image.output_path, source_sha256: fingerprint.sha256, source_size: fingerprint.size,
  approval_revision: englishThumbnailApprovalRevision({ sourceJobId: source.id, thumbnailId: image.id, sourcePath: image.output_path, ...fingerprint }, source.channel_id) };

describe("exact approved English source", () => {
  it("captures immutable exact bytes rather than leaving a mutable path for the provider", () => {
    const encoded = approvedReferenceDataUrl(bytes, fingerprint);
    expect(Buffer.from(encoded.split(",")[1]!, "base64")).toEqual(bytes);
    expect(() => approvedReferenceDataUrl(Buffer.concat([bytes, Buffer.from([5])]), fingerprint)).toThrow();
    expect(() => approvedReferenceDataUrl(Buffer.from([0,216,255,224,1,2,3,4]), fingerprint)).toThrow();
  });
  it("accepts the selected approved image before recording completion", () => {
    expect(() => assertEnglishThumbnailSource(intent as never, source as never, [image] as never)).not.toThrow();
  });
  it.each([{ id: "another-image" }, { review_verdict: "not_reviewed" }, { channel_id: "other" }, { output_path: "/media/replaced.jpg" }, { status: "generating" }])("rejects changed source identity or approval %j", (change) => {
    expect(() => assertEnglishThumbnailSource(intent as never, source as never, [{ ...image, ...change }] as never)).toThrow();
  });
  it("rejects ambiguous selection, cancellation and rework", () => {
    expect(() => assertEnglishThumbnailSource(intent as never, source as never, [image, image] as never)).toThrow();
    expect(() => assertEnglishThumbnailSource(intent as never, { ...source, status: "CANCELLED" } as never, [image] as never)).toThrow();
    expect(() => assertEnglishThumbnailSource(intent as never, { ...source, va_review_status: "rework_requested" } as never, [image] as never)).toThrow();
  });
  it("does not call a provider when the source fence fails", async () => {
    const ports = { claim: vi.fn().mockResolvedValue(intent), reference: vi.fn().mockRejectedValue(new Error("source changed")), generate: vi.fn(), finish: vi.fn(), fail: vi.fn() };
    await runEnglishThumbnailFanout(ports as FanoutPorts);
    expect(ports.generate).not.toHaveBeenCalled(); expect(ports.finish).not.toHaveBeenCalled(); expect(ports.fail).toHaveBeenCalledOnce();
  });
  it("does not retry a failed provider call or prevent another locale from succeeding", async () => {
    const ports = { claim: vi.fn().mockResolvedValue(intent), reference: vi.fn().mockResolvedValue({ dataUrl: "exact", child: {} }), generate: vi.fn().mockResolvedValueOnce({ status: "failed" }).mockResolvedValueOnce({ status: "completed", thumbnailId: "output" }), finish: vi.fn(), fail: vi.fn() };
    await runEnglishThumbnailFanout(ports as FanoutPorts); await runEnglishThumbnailFanout(ports as FanoutPorts);
    expect(ports.generate).toHaveBeenCalledTimes(2); expect(ports.fail).toHaveBeenCalledTimes(1); expect(ports.finish).toHaveBeenCalledTimes(1);
    expect(ports.fail).toHaveBeenCalledWith(intent, expect.any(String), "uncertain");
  });
  it("only records a safe failed state for explicitly definite pre-image failure", async () => {
    const ports = { claim: vi.fn().mockResolvedValue(intent), reference: vi.fn().mockResolvedValue({ dataUrl: "exact", child: {} }), generate: vi.fn().mockResolvedValue({ status: "failed", failureCertainty: "definite" }), finish: vi.fn(), fail: vi.fn() };
    await runEnglishThumbnailFanout(ports as FanoutPorts);
    expect(ports.fail).toHaveBeenCalledWith(intent, expect.any(String), "failed");
  });
});

describe("automatic English candidate batch", () => {
  function admissionDb(replies: unknown[][]) {
    const select = vi.fn(() => { const p = Promise.resolve(replies.shift()); const q = { from: () => q, where: () => q, limit: () => q, for: () => q, then: p.then.bind(p) }; return q; });
    const tx = { select, insert: vi.fn() };
    return { select, insert: tx.insert, transaction: async (fn: (tx: unknown) => unknown) => fn(tx) };
  }
  it("does not enroll historical completed work even when script and copy exist", async () => {
    const db = admissionDb([[{ ...source, status: "COMPLETED" }], [{ thumbnail_generation_mode: "ai" }], [source], [], []]);
    const queue = { getJob: vi.fn(), add: vi.fn() };
    expect(await enqueueAutomaticEnglishThumbnails(db as never, queue as never, source.id, { recoverOnly: true })).toBe(0);
    expect(db.insert).not.toHaveBeenCalled(); expect(queue.add).not.toHaveBeenCalled();
  });
  it("recovers an explicit replacement batch despite an older selected thumbnail", async () => {
    const batch = automaticEnglishBatch(source)!;
    const db = admissionDb([[source], [{ thumbnail_generation_mode: "ai" }], [source], [], [{ request_id: batch.requestId, payload: { payload: batch.payload, count: 5 } }], [{ attempted: [] }], []]);
    const queue = { getJob: vi.fn().mockResolvedValue(null), add: vi.fn() };
    expect(await enqueueAutomaticEnglishThumbnails(db as never, queue as never, source.id)).toBe(5);
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("creates five manual-selection candidates using a stable revision identity", () => {
    const first = automaticEnglishBatch(source)!;
    expect(first.count).toBe(5); expect(first.payload.manualSelection).toBe(true);
    expect(automaticEnglishBatch({ ...source })?.requestId).toBe(first.requestId);
    expect(automaticEnglishBatch({ ...source, script_text: "Revised instructions" })?.requestId).not.toBe(first.requestId);
    expect(automaticEnglishBatch({ ...source, source_job_id: source.id, language: "de" })).toBeNull();
  });
  it("recovers only missing variants, preserving even failed existing attempts", async () => {
    const existing = [{ variant: 0 }, { variant: 2 }];
    const db = admissionDb([[{ attempted: [] }], existing]);
    const queue = { getJob: vi.fn().mockImplementation(async (id: string) => id.endsWith("-3") ? {} : null), add: vi.fn() };
    const batch = automaticEnglishBatch(source)!;
    expect(await enqueueSavedEnglishBatch(db as never, queue as never, source.id, batch.requestId, batch.payload, 5)).toBe(2);
    expect(queue.add.mock.calls.map(call => call[1].variantIndex)).toEqual([1,4]);
    expect(queue.add.mock.calls.every(call => call[1].manualSelection === true && call[2].attempts === 1)).toBe(true);
  });
  it("does not requeue admitted variants even after Redis and output records are absent", async () => {
    const db = admissionDb([[{ attempted: [0,1,2,3,4] }], []]);
    const queue = { getJob: vi.fn().mockResolvedValue(null), add: vi.fn() };
    const batch = automaticEnglishBatch(source)!;
    expect(await enqueueSavedEnglishBatch(db as never, queue as never, source.id, batch.requestId, batch.payload, 5)).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
