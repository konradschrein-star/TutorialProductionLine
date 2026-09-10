import { expect, it, vi } from "vitest";
import { measureExactTutorialOutput } from "../utils/tutorial/output-qa.js";
const identity = { path: "/media/output.mp4", sourceRevision: "source", completedAt: "2026-09-09T00:00:00.000Z", previous: null, previousStatus: null };
const verdict: any = { passed: true, summary: "Measured", checks: [{ id: "black", status: "pass", detail: "No black", measured: { longest_black_seconds: 0 } }] };
const ports = () => ({ fingerprint: vi.fn().mockResolvedValue({ sha256: "abc", bytes: 100 }), measure: vi.fn().mockResolvedValue(verdict) });
it("measures exact output and reuses the same revision idempotently even after JSONB key reorder", async () => {
  const p = ports(), first = await measureExactTutorialOutput(identity, p);
  const saved: any = first.detail;
  saved.identity = Object.fromEntries(Object.entries(saved.identity).reverse());
  const next = await measureExactTutorialOutput({ ...identity, previous: saved, previousStatus: first.status }, p);
  expect(next.cached).toBe(true); expect(p.measure).toHaveBeenCalledTimes(1);
});
it.each(["bytes", "source", "timestamp"])("remeasures changed %s rather than reusing a pass", async change => {
  const p = ports(), first = await measureExactTutorialOutput(identity, p);
  if (change === "bytes") p.fingerprint.mockResolvedValue({ sha256: "new", bytes: 100 });
  await measureExactTutorialOutput({ ...identity, previous: first.detail, previousStatus: first.status, ...(change === "source" ? { sourceRevision: "new" } : {}), ...(change === "timestamp" ? { completedAt: "new" } : {}) }, p);
  expect(p.measure).toHaveBeenCalledTimes(2);
});
it("discards a file changing while decoded", async () => {
  const p = ports(); p.fingerprint.mockResolvedValueOnce({ sha256: "before", bytes: 100 }).mockResolvedValueOnce({ sha256: "after", bytes: 100 });
  await expect(measureExactTutorialOutput(identity, p)).rejects.toThrow("changed");
});
it("never turns failed ffmpeg execution into a passed check", async () => {
  const p = ports(); p.measure.mockRejectedValue(new Error("decode failed"));
  await expect(measureExactTutorialOutput(identity, p)).rejects.toThrow("decode failed");
});
it("persists a measured fail without changing job status", async () => {
  const p = ports(); p.measure.mockResolvedValue({ ...verdict, passed: false });
  expect((await measureExactTutorialOutput(identity, p)).status).toBe("failed");
});
