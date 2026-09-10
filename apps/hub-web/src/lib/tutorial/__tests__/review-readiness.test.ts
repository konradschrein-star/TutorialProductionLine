import { describe, expect, it } from "vitest";
import { reviewBlockingReasons } from "../review-readiness";
describe("review UI prerequisites", () => {
  for (const channel of [false, true]) for (const video of [false, true]) for (const thumbnail of [false, true]) {
    it(`checks channel=${channel}, video=${video}, thumbnail=${thumbnail}`, () => {
      const reasons = reviewBlockingReasons({ channelId: channel ? "assigned-channel" : null, playable: video, hasThumbnail: thumbnail });
      expect(reasons).toHaveLength(Number(!channel) + Number(!video) + Number(!thumbnail));
    });
  }
});
