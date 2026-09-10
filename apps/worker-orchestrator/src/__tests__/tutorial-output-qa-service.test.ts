import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: vi.fn(), save: vi.fn(), measure: vi.fn(), lease: vi.fn(), returned: vi.fn(), leased: false }));
vi.mock("@repo/storage", () => ({ fingerprintStorageSource: async () => ({ sha256: "abc", bytes: 100 }), withTutorialMedia: (...args: any[]) => m.lease(...args) }));
vi.mock("@repo/media-core", () => ({ SCREEN_RECORDING_QA_THRESHOLDS: {}, runVideoQaGate: (...args: any[]) => m.measure(...args) }));
const { ensureTutorialOutputQa } = await import("../utils/tutorial/output-qa.js");
const row = { id: "test", status: "COMPLETED", final_path: "/media/output.mp4", completed_at: new Date("2026-09-09T00:00:00Z"), recording_path: "/media/raw.mp4", audio_path: null, script_text: "script", recorded_at: new Date(0), output_qa_status: null, output_qa_detail: null };
const tx: any = { select: () => { const q: any = { from: () => q, where: () => q, for: () => q, then: (resolve: any) => Promise.resolve(m.rows()).then(resolve) }; return q; }, update: () => { expect(m.leased).toBe(false); return { set: (value: unknown) => { m.save(value); return { where: () => ({ returning: async () => m.returned() }) }; } }; } };
const db: any = { ...tx, transaction: async (run: any) => run(tx) };
beforeEach(() => { vi.clearAllMocks(); m.leased = false; m.returned.mockResolvedValue([{ id: row.id }]); m.rows.mockResolvedValue([row]); m.lease.mockImplementation(async (_db, request, options, consume) => { expect(request.kind).toBeNull(); expect(options.transaction).toBe(tx); m.leased = true; try { return await consume(request.path); } finally { m.leased = false; } }); m.measure.mockResolvedValue({ passed: true, summary: "Measured", checks: [{ id: "black", status: "pass", measured: { longest_black_seconds: 0 } }] }); });
it("measures through a local-only pinned media lease and persists evidence", async () => {
  expect(await ensureTutorialOutputQa(db, row.id, "/media")).toBe("passed");
  expect(m.lease).toHaveBeenCalledTimes(1);
  expect(m.save.mock.calls[0]?.[0]).toMatchObject({ output_qa_status: "passed", output_qa_detail: { identity: { completedAt: row.completed_at.toISOString(), sha256: "abc" } } });
});
it("isolates decode failure as unverified, not a completed-job failure", async () => {
  m.measure.mockRejectedValue(new Error("ffmpeg failed"));
  expect(await ensureTutorialOutputQa(db, row.id, "/media")).toBe("unverified");
  expect(m.save.mock.calls[0]?.[0]).toMatchObject({ output_qa_status: null, output_qa_detail: { checks: [] } });
  expect(m.save.mock.calls[0]?.[0]).not.toHaveProperty("status");
});
it("discards measured evidence when the render changed before persistence", async () => {
  m.returned.mockResolvedValue([]); // Exact-input compare-and-swap no longer matches.
  expect(await ensureTutorialOutputQa(db, row.id, "/media")).toBe("unverified");
  expect(m.returned).toHaveBeenCalledTimes(1);
});
it("does not measure uncompleted or absent jobs", async () => {
  m.rows.mockResolvedValue([]);
  expect(await ensureTutorialOutputQa(db, row.id, "/media")).toBe("unverified");
  expect(m.lease).not.toHaveBeenCalled();
});
