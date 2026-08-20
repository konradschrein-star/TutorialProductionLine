import { describe, it, expect } from "vitest";
import {
  utcDateKey,
  compareUploadPriority,
  UPLOAD_PRIORITY,
} from "../daily-budget.js";

describe("utcDateKey", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    expect(utcDateKey(new Date("2026-07-28T23:59:59Z"))).toBe("2026-07-28");
    expect(utcDateKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("upload priority", () => {
  it("orders small/high-value artefacts before large ones", () => {
    const order = [
      "raw_recording",
      "final_video",
      "thumbnail",
      "subtitles",
      "transcript",
      "metadata",
    ].sort(compareUploadPriority);
    expect(order).toEqual([
      "metadata",
      "transcript",
      "subtitles",
      "thumbnail",
      "final_video",
      "raw_recording",
    ]);
  });

  it("metadata is highest priority, raw_recording lowest", () => {
    expect(UPLOAD_PRIORITY["metadata"]).toBeLessThan(
      UPLOAD_PRIORITY["final_video"]!,
    );
    expect(UPLOAD_PRIORITY["raw_recording"]).toBeGreaterThan(
      UPLOAD_PRIORITY["final_video"]!,
    );
  });
});
