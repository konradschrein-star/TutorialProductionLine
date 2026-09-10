import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ lease: vi.fn(), capture: vi.fn(), active: false }));
vi.mock("../utils/tutorial/media-inputs.js", () => ({ withTutorialPublicationInputs: mocked.lease }));
vi.mock("@repo/media-core", () => ({ capturePublicationApproval: mocked.capture, publicationApprovalMatches: () => false }));
vi.mock("@repo/db", async (original) => ({ ...await original<typeof import("@repo/db")>(), tutorialSourceRevision: () => "source-revision" }));
import { recoverAutomaticScheduledDelivery } from "../services/automatic-scheduled-delivery.js";
import { reconcileLateLocalePublication } from "../services/late-locale-publication.js";

function database() {
  const source = { id: "source", status: "COMPLETED", channel_id: "channel", language: "en", final_path: "/media/source.mp4", title: "Tutorial", description: "Description", tags: ["tutorial"], thumbnail_text_top: "How", thumbnail_text_bottom: "To", va_review_status: "approved", publication_approval: { revision: "approved" } };
  const child = { ...source, id: "child", source_job_id: "source", publication_approval: null, localization_source_revision: "source-revision" };
  const asset = { id: "thumbnail", channel_id: "channel", language: "en", output_path: "/media/thumbnail.png", status: "completed", review_verdict: "acceptable" };
  const rows = [[source], [child], [], [asset]];
  function query(result: unknown[]) {
    const q: any = { then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
    for (const key of ["from", "where", "for", "innerJoin", "leftJoin", "orderBy", "limit"]) q[key] = () => q;
    return q;
  }
  const tx = { select: vi.fn(() => query(rows.shift()!)), update: vi.fn(), insert: vi.fn() };
  const db: any = { select: () => query([{ id: "child", sourceId: "source" }]), transaction: (consume: (t: unknown) => unknown) => consume(tx), insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }) };
  return { db, tx };
}

beforeEach(() => {
  vi.clearAllMocks(); mocked.active = false;
  mocked.capture.mockImplementation(async () => { expect(mocked.active).toBe(true); return { revision: "current" }; });
});

describe.each([
  ["automatic scheduled recovery", recoverAutomaticScheduledDelivery],
  ["late locale recovery", reconcileLateLocalePublication],
] as const)("%s media guards", (_name, run) => {
  it("restores and hashes on the same caller transaction while leased", async () => {
    const { db, tx } = database();
    mocked.lease.mockImplementation(async (_input, consume, options) => {
      expect(options.transaction).toBe(tx);
      mocked.active = true;
      try { return await consume(); } finally { mocked.active = false; }
    });
    await run(db);
    expect(mocked.lease).toHaveBeenCalledWith(expect.objectContaining({ jobId: "source", videoPath: "/media/source.mp4", thumbnailPath: "/media/thumbnail.png" }), expect.any(Function), { transaction: tx });
    expect(mocked.capture).toHaveBeenCalledOnce();
    expect(mocked.active).toBe(false);
    expect(tx.update).not.toHaveBeenCalled(); expect(tx.insert).not.toHaveBeenCalled();
  });
  it("does not hash or approve when verified bytes cannot be restored", async () => {
    const { db, tx } = database();
    mocked.lease.mockRejectedValue(new Error("Verified archive unavailable"));
    await run(db);
    expect(mocked.lease).toHaveBeenCalledOnce();
    expect(mocked.capture).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled(); expect(tx.insert).not.toHaveBeenCalled();
  });
});
