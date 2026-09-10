import { expect, it } from "vitest";
import { escapeRecordSearch, stageTimeLabel } from "../activity-records";
it("does not fabricate stage age for old records without events", () => {
  expect(stageTimeLabel("READY_TO_RECORD", null)).toBe("Stage start not recorded");
  expect(stageTimeLabel("READY_TO_RECORD", "invalid")).toBe("Stage start not recorded");
});
it("labels stage elapsed as automation rather than VA inactivity", () => {
  expect(stageTimeLabel("GENERATING_AUDIO", "2026-09-08T10:00:00Z", Date.parse("2026-09-08T11:30:00Z"))).toBe("Automation stage elapsed: 1h 30m");
  expect(stageTimeLabel("COMPLETED", "2026-09-08T10:00:00Z", Date.parse("2026-09-08T10:30:00Z"))).toBe("Stage entered 30m ago");
});
it("literalizes search wildcards", () => {
  expect(escapeRecordSearch("50%_done\\")).toBe("%50\\%\\_done\\\\%");
});
