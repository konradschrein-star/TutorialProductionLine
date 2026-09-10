import { afterEach, expect, it, vi } from "vitest";
import { enqueueAutomaticEnglishThumbnails, enqueueSavedEnglishBatch, startAutomaticEnglishThumbnails } from "../automatic-english-thumbnails.js";
import { runEnglishThumbnailFanout, startEnglishThumbnailFanout } from "../english-thumbnail-fanout.js";
import { tutorialAiThumbnailsEnabled } from "../../utils/tutorial/ai-thumbnail-policy.js";
import { requestThumbnail } from "../../utils/thumbnail/index.js";
afterEach(() => vi.unstubAllEnvs());
it("preserves existing default while accepting the deployment stop", () => {
  expect(tutorialAiThumbnailsEnabled({})).toBe(true);
  expect(tutorialAiThumbnailsEnabled({ TUTORIAL_AI_THUMBNAILS_ENABLED: "false" })).toBe(false);
});
it("disabled automatic entrypoints do not query, enqueue, claim or start timers", async () => {
  vi.stubEnv("TUTORIAL_AI_THUMBNAILS_ENABLED", "false");
  const forbidden = new Proxy({}, { get() { throw Error("Disabled AI touched a dependency"); } });
  await expect(enqueueAutomaticEnglishThumbnails(forbidden as never, forbidden as never, "source")).resolves.toBe(0);
  await expect(enqueueSavedEnglishBatch(forbidden as never, forbidden as never, "source", "request", {} as never, 5)).resolves.toBe(0);
  await expect(runEnglishThumbnailFanout(forbidden as never)).resolves.toBe(false);
  expect(() => startAutomaticEnglishThumbnails(forbidden as never, forbidden as never)()).not.toThrow();
  expect(() => startEnglishThumbnailFanout(forbidden as never)()).not.toThrow();
  await expect(requestThumbnail(forbidden as never, { subjectKind: "tutorial_job" } as never)).resolves.toMatchObject({ status: "failed", failureCertainty: "definite", thumbnailId: "" });
});
