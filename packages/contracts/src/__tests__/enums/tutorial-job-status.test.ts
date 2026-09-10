import { describe, it, expect } from "vitest";
import { TutorialJobStatus } from "../../enums/tutorial-job-status.js";

const EXPECTED = [
  "QUEUED",
  "AWAITING_THUMBNAILS",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "SPLICING",
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
] as const;

describe("TutorialJobStatus", () => {
  it("has exactly the expected values", () => {
    expect([...TutorialJobStatus.options].sort()).toEqual([...EXPECTED].sort());
  });
  it("parses a valid value and rejects an invalid one", () => {
    expect(TutorialJobStatus.safeParse("READY_TO_RECORD").success).toBe(true);
    expect(TutorialJobStatus.safeParse("NOPE").success).toBe(false);
  });
});
