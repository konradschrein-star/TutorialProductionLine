import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ job: vi.fn(), update: vi.fn(), media: vi.fn(), llm: vi.fn(), tts: vi.fn(), probe: vi.fn(), mux: vi.fn() }));
vi.mock("@repo/db", async importOriginal => ({ ...await importOriginal<object>(), getTutorialJobById: mocks.job, updateTutorialJob: mocks.update }));
vi.mock("@repo/media-core", async importOriginal => ({ ...await importOriginal<object>(), probeMedia: mocks.probe, muxTtsOntoRecording: mocks.mux }));
vi.mock("../utils/tutorial/media-inputs.js", () => ({ withTutorialWorkerInputs: mocks.media }));
vi.mock("../utils/tutorial/llm-registry.js", () => ({ generateScript: mocks.llm }));
vi.mock("../utils/tutorial/tts-registry.js", () => ({ createTutorialTTSProvider: mocks.tts, formatTtsChainFailure: vi.fn() }));
vi.mock("../utils/tutorial/localization-fence.js", () => ({ assertLocalizationCurrent: async () => undefined }));
vi.mock("../utils/tutorial/thumbnail-context.js", () => ({ selectTranslationChannel: () => ({ id: "spanish-channel" }), resolveTutorialThumbnailContext: vi.fn() }));
const { createTutorialTranslateProcessor } = await import("../processors/tutorial/translate.js");
const { createTutorialSpliceProcessor } = await import("../processors/tutorial/splice.js");
const sourceId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.clearAllMocks(); mocks.media.mockRejectedValue(new Error("Media unavailable: no exact verified Drive revision; restore original recording")); });
it("blocks translation before LLM/TTS when the raw source cannot be restored", async () => {
  mocks.job.mockResolvedValue({ id: sourceId, source_job_id: null, language: "en", status: "COMPLETED", recording_path: "/media/source.mp4", script_text: "Tutorial narration" });
  const db = { select: () => ({ from: () => ({ where: async () => [] }) }) };
  const run = createTutorialTranslateProcessor(db as never, { tutorialSplice: { add: vi.fn() } } as never);
  await expect(run({ data: { sourceJobId: sourceId, targetLanguage: "es" }, attemptsMade: 0, opts: { attempts: 2 } } as never)).rejects.toThrow("restore original recording");
  expect(mocks.media).toHaveBeenCalledWith({ jobId: sourceId, recordingPath: "/media/source.mp4" }, expect.any(Function));
  expect(mocks.llm).not.toHaveBeenCalled(); expect(mocks.tts).not.toHaveBeenCalled();
});
it("blocks FFmpeg/probing until raw and narration inputs pass hydration/local validation", async () => {
  mocks.job.mockResolvedValue({ id: childId, source_job_id: sourceId, status: "AWAITING_UPLOAD", recording_path: "/media/source.mp4", audio_path: "/media/es.mp3" });
  const run = createTutorialSpliceProcessor({} as never, { tutorialStitch: {}, thumbnail: {} } as never);
  await expect(run({ data: { jobId: childId }, attemptsMade: 0, opts: { attempts: 2 } } as never)).rejects.toThrow("restore original recording");
  expect(mocks.media).toHaveBeenCalledWith({ jobId: childId, sourceJobId: sourceId, recordingPath: "/media/source.mp4", audioPath: "/media/es.mp3" }, expect.any(Function));
  expect(mocks.probe).not.toHaveBeenCalled(); expect(mocks.mux).not.toHaveBeenCalled();
});
