import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI33_DEFAULT_IMAGE_MODEL,
  AI33_DEFAULT_IMAGE_RESOLUTION,
  ai33ImageModel,
} from "../index.js";

/**
 * Which AI33 model actually draws an image.
 *
 * This has been wrong twice, both times silently:
 *   1. The ai33 branch passed no override at all, so the model came from
 *      `@repo/media-core`'s PRIMARY_MODEL two packages away and `AI33_IMAGE_MODEL`
 *      appeared to work while changing nothing.
 *   2. The host-wide default was set to `gpt-image-2` for BUSINESS_PLAN_HUB, which
 *      also silently moved tutorial scene images and thumbnails onto a model
 *      chosen for a different format.
 *
 * Neither failed. Both produced images. That is exactly why they need a test:
 * the only symptom is a model id in a log nobody reads.
 */
describe("ai33ImageModel", () => {
  const saved = {
    model: process.env["AI33_IMAGE_MODEL"],
    resolution: process.env["AI33_IMAGE_RESOLUTION"],
  };

  beforeEach(() => {
    delete process.env["AI33_IMAGE_MODEL"];
    delete process.env["AI33_IMAGE_RESOLUTION"];
  });

  afterEach(() => {
    if (saved.model === undefined) delete process.env["AI33_IMAGE_MODEL"];
    else process.env["AI33_IMAGE_MODEL"] = saved.model;
    if (saved.resolution === undefined)
      delete process.env["AI33_IMAGE_RESOLUTION"];
    else process.env["AI33_IMAGE_RESOLUTION"] = saved.resolution;
  });

  it("defaults to Nano Banana 2, the id AI33 actually serves", () => {
    // Verified live against AI33 on 2026-08-16: submit → done, 1726 credits.
    // If this id ever stops matching `GET /v1i/models`, submission 400s.
    expect(AI33_DEFAULT_IMAGE_MODEL).toBe("gemini-3.1-flash-image-preview");
    expect(ai33ImageModel()).toEqual({
      id: "gemini-3.1-flash-image-preview",
      resolution: AI33_DEFAULT_IMAGE_RESOLUTION,
    });
  });

  it("agrees with @repo/media-core's PRIMARY_MODEL", async () => {
    // The gateway ALWAYS passes an override, so media-core's own constant is
    // unreachable — a disagreement is invisible until someone reads the logs.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL(
          "../../../../../../packages/media-core/src/ai33/image.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const primary = /PRIMARY_MODEL\s*=\s*\{[^}]*id:\s*"([^"]+)"/.exec(src)?.[1];
    expect(primary).toBe(AI33_DEFAULT_IMAGE_MODEL);
  });

  it("honours the host-wide AI33_IMAGE_MODEL env pin", () => {
    process.env["AI33_IMAGE_MODEL"] = "gpt-image-2";
    expect(ai33ImageModel().id).toBe("gpt-image-2");
  });

  it("carries the ambient resolution only when the model is also ambient", () => {
    process.env["AI33_IMAGE_RESOLUTION"] = "4K";
    expect(ai33ImageModel().resolution).toBe("4K");

    // A per-request MODEL pin must NOT inherit a resolution configured for a
    // different model — seven of AI33's models reject a task that carries one.
    expect(ai33ImageModel({ imageModel: "krea-2-fast" }).resolution).toBeUndefined();
  });

  it("lets a per-request pin beat the env", () => {
    process.env["AI33_IMAGE_MODEL"] = "gpt-image-2";
    expect(ai33ImageModel({ imageModel: "gemini-3-pro-image" }).id).toBe(
      "gemini-3-pro-image",
    );
  });
});
