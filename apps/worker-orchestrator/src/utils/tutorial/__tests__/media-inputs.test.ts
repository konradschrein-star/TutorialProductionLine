import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), create: vi.fn() }));
vi.mock("@repo/storage", () => ({ withTutorialMediaSet: mocks.set }));
vi.mock("@repo/db", () => ({ createDrizzleClient: mocks.create }));
const { withTutorialWorkerInputs, withTutorialPublicationInputs } = await import("../media-inputs.js");
beforeEach(() => { vi.clearAllMocks(); });
it("reuses a publication transaction and passes exact approval hashes without another pool",async()=>{
 const transaction={};const video={sha256:"a".repeat(64),size:12};const thumbnail={sha256:"b".repeat(64),size:3};
 mocks.set.mockImplementation(async(_db,_requests,_options,consume)=>consume());
 await withTutorialPublicationInputs({jobId:"job",videoPath:"/media/final.mp4",thumbnailPath:"/media/thumb.jpg",video,thumbnail},async()=>undefined,{transaction:transaction as never,mediaRoot:"/media"});
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.set).toHaveBeenCalledWith(transaction,[{jobId:"job",kind:"final_video",path:"/media/final.mp4",expectedContent:video},{jobId:"job",kind:"thumbnail",path:"/media/thumb.jpg",expectedContent:thumbnail}],expect.objectContaining({transaction}),expect.any(Function));
});
it("routes child footage to its source owner and narration to an explicit local-only input", async () => {
  mocks.set.mockImplementation(async (_db, _requests, _options, consume) => consume());
  const db = {};
  await withTutorialWorkerInputs({ jobId: "child", sourceJobId: "source", recordingPath: "/media/raw.mp4", audioPath: "/media/narration.mp3" }, async () => "done", { db: db as never, mediaRoot: "/media" });
  expect(mocks.set).toHaveBeenCalledWith(db, [{ jobId: "source", kind: "raw_recording", path: "/media/raw.mp4" }, { jobId: "child", kind: null, path: "/media/narration.mp3" }], expect.objectContaining({ allowedRoots: ["/media"] }), expect.any(Function));
});
it("retains the lease until the real consumer finishes and releases on failure", async () => {
  let active = false;
  mocks.set.mockImplementation(async (_db, _requests, _options, consume) => { active = true; try { return await consume(); } finally { active = false; } });
  await expect(withTutorialWorkerInputs({ jobId: "source", recordingPath: "/media/raw.mp4" }, async () => { expect(active).toBe(true); await Promise.resolve(); throw new Error("provider failed"); }, { db: {} as never })).rejects.toThrow("provider failed");
  expect(active).toBe(false);
});
it("releases only after successful asynchronous consumer completion", async () => {
  const order: string[] = [];
  mocks.set.mockImplementation(async (_db, _requests, _options, consume) => { order.push("locked"); try { return await consume(); } finally { order.push("released"); } });
  await withTutorialWorkerInputs({ jobId: "source", recordingPath: "/media/raw.mp4" }, async () => { await Promise.resolve(); order.push("finished"); }, { db: {} as never });
  expect(order).toEqual(["locked", "finished", "released"]);
});
it("uses a singleton dedicated pool capped at two connections", async () => {
  const before = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://offline-test";
  mocks.create.mockReturnValue({ dedicated: true }); mocks.set.mockResolvedValue(undefined);
  try {
    await withTutorialWorkerInputs({ jobId: "source", recordingPath: "/media/raw.mp4" }, async () => undefined);
    await withTutorialWorkerInputs({ jobId: "source", recordingPath: "/media/raw.mp4" }, async () => undefined);
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.create).toHaveBeenCalledWith("postgres://offline-test", { max: 2 });
  } finally { if (before === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before; }
});
