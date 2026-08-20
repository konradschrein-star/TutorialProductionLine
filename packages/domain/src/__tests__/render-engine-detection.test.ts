import { describe, it, expect } from "vitest";
import { willUseRemotionRenderer } from "../render-engine-detection.js";

describe("willUseRemotionRenderer", () => {
  it("returns true when template override is REMOTION", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: "REMOTION",
      captionsEnabled: false,
      hasPictureInPicture: false,
      hasNewsTicker: false,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(true);
  });

  it("returns false when template override is FFMPEG", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: "FFMPEG",
      captionsEnabled: true, // Even with captions, override wins
      hasPictureInPicture: false,
      hasNewsTicker: false,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(false);
  });

  it("returns true when captions enabled and no override", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: undefined,
      captionsEnabled: true,
      hasPictureInPicture: false,
      hasNewsTicker: false,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(true);
  });

  it("returns true when PiP enabled and no override", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: undefined,
      captionsEnabled: false,
      hasPictureInPicture: true,
      hasNewsTicker: false,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(true);
  });

  it("returns true when news ticker enabled and no override", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: undefined,
      captionsEnabled: false,
      hasPictureInPicture: false,
      hasNewsTicker: true,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(true);
  });

  it("returns true when animated transitions enabled and no override", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: undefined,
      captionsEnabled: false,
      hasPictureInPicture: false,
      hasNewsTicker: false,
      hasAnimatedTransitions: true,
    });
    expect(result).toBe(true);
  });

  it("returns false when no features enabled and no override", () => {
    const result = willUseRemotionRenderer({
      templateEngineOverride: undefined,
      captionsEnabled: false,
      hasPictureInPicture: false,
      hasNewsTicker: false,
      hasAnimatedTransitions: false,
    });
    expect(result).toBe(false);
  });
});
