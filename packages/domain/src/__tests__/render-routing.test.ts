import { describe, it, expect } from "vitest";
import {
  decideRenderEngine,
  type RenderRoutingInput,
} from "../render-routing.js";

const BASE_INPUT: RenderRoutingInput = {
  captionsEnabled: false,
  hasAvatarFootage: false,
  hasPictureInPicture: false,
  hasNewsTicker: false,
  hasAnimatedTransitions: false,
  sceneCount: 1,
  templateEngineOverride: undefined,
};

describe("decideRenderEngine", () => {
  it("chooses FFMPEG for simple composition (all features false)", () => {
    expect(decideRenderEngine(BASE_INPUT)).toBe("FFMPEG");
  });

  it("chooses REMOTION when captionsEnabled is true", () => {
    expect(decideRenderEngine({ ...BASE_INPUT, captionsEnabled: true })).toBe(
      "REMOTION",
    );
  });

  it("chooses REMOTION when hasNewsTicker is true", () => {
    expect(decideRenderEngine({ ...BASE_INPUT, hasNewsTicker: true })).toBe(
      "REMOTION",
    );
  });

  it("chooses REMOTION when hasPictureInPicture is true", () => {
    expect(
      decideRenderEngine({ ...BASE_INPUT, hasPictureInPicture: true }),
    ).toBe("REMOTION");
  });

  it("chooses REMOTION when hasAnimatedTransitions is true", () => {
    expect(
      decideRenderEngine({ ...BASE_INPUT, hasAnimatedTransitions: true }),
    ).toBe("REMOTION");
  });

  it("respects templateEngineOverride FFMPEG even when features require REMOTION", () => {
    expect(
      decideRenderEngine({
        ...BASE_INPUT,
        captionsEnabled: true,
        hasPictureInPicture: true,
        hasNewsTicker: true,
        hasAnimatedTransitions: true,
        templateEngineOverride: "FFMPEG",
      }),
    ).toBe("FFMPEG");
  });

  it("respects templateEngineOverride REMOTION even when no features require it", () => {
    expect(
      decideRenderEngine({
        ...BASE_INPUT,
        templateEngineOverride: "REMOTION",
      }),
    ).toBe("REMOTION");
  });
});
