import { describe, expect, it } from "vitest";
import {
  adjacentReviewId,
  localeProgress,
  reviewShortcut,
} from "../review-workflow";
const context = {
  enabled: true,
  busy: false,
  editing: false,
  modalOpen: false,
};
describe("focused review keyboard controls", () => {
  it.each([
    ["q", "approve"],
    ["r", "rework"],
    ["j", "next"],
    ["k", "previous"],
    [" ", "play"],
  ])("maps %s to %s", (key, action) =>
    expect(reviewShortcut({ key: key! }, context)).toBe(action),
  );
  it.each([
    "repeat",
    "ctrlKey",
    "altKey",
    "metaKey",
    "shiftKey",
    "isComposing",
    "defaultPrevented",
  ])("ignores %s", (flag) =>
    expect(reviewShortcut({ key: "q", [flag]: true }, context)).toBeNull(),
  );
  it.each(["busy", "editing", "modalOpen"])("ignores %s context", (flag) =>
    expect(
      reviewShortcut({ key: "q" }, { ...context, [flag]: true }),
    ).toBeNull(),
  );
  it("requires explicit enable and does not capture old ambiguous W/E or system keys", () => {
    expect(
      reviewShortcut({ key: "q" }, { ...context, enabled: false }),
    ).toBeNull();
    for (const key of ["w", "e", "Escape", "Enter", "ArrowLeft", "Tab"])
      expect(reviewShortcut({ key }, context)).toBeNull();
  });
  it("enables safe navigation by default but protects typing and dialogs", () => {
    expect(reviewShortcut({ key: "j" }, { ...context, enabled: false })).toBe("next");
    expect(reviewShortcut({ key: "k" }, { ...context, enabled: false })).toBe("previous");
    for (const flag of ["editing", "modalOpen", "busy"]) expect(reviewShortcut({ key: "j" }, { ...context, enabled: false, [flag]: true })).toBeNull();
  });
  it("moves relative to the selected job without wrapping or skipping to first unreviewed", () => {
    expect(adjacentReviewId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(adjacentReviewId(["a", "b", "c"], "b", -1)).toBe("a");
    expect(adjacentReviewId(["a", "b"], "b", 1)).toBe("b");
    expect(adjacentReviewId(["a", "b"], "a", -1)).toBe("a");
    expect(adjacentReviewId([], null, 1)).toBeNull();
  });
});
describe("independent locale progress", () => {
  it("does not ask for approval again when the exact selected thumbnail is approved", () => {
    expect(localeProgress("AWAITING_THUMBNAILS", true).label).toBe("Ready for localization");
    expect(localeProgress("AWAITING_THUMBNAILS", false).label).toBe("Waiting for thumbnail approval");
    expect(localeProgress("QUEUED", true).label).toBe("Queued");
  });
  it.each([
    [undefined, "Not started", "start"],
    ["AWAITING_THUMBNAILS", "Waiting for thumbnail approval", "start"],
    ["FAILED_RENDER", "Needs attention", "retry"],
    ["CANCELLED", "Stopped", "retry"],
    ["QUEUED", "Queued", null],
    ["COMPLETED", "Video produced", null],
  ])("labels %s without claiming delivery", (status, label, action) =>
    expect(localeProgress(status)).toMatchObject({ label, action }),
  );
  it("does not turn an unknown in-flight state into completion", () =>
    expect(localeProgress("SYNTHESIZING")).toMatchObject({
      kind: "pending",
      action: null,
    }));
});
