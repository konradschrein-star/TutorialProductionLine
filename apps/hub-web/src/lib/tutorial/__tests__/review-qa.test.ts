import { expect, it } from "vitest";
import { currentReviewQaDetail, reviewQaEvidence } from "../review-qa";
it("does not invent measured passes from top-level QA success", () => {
  for (const detail of [null, { passed: true }, { checks: [{ id: "black", status: "pass" }] }]) {
    expect(reviewQaEvidence(detail).every(row => row.status === "unverified")).toBe(true);
  }
});
it("projects only actual saved checks and numeric measurements", () => {
  const evidence = reviewQaEvidence({ secret: "hidden", checks: [{ id: "loudness", status: "warn", integrated_lufs: -21, target_lufs: -14, detail: "/private/path" }, { id: "black", status: "pass", longest_black_seconds: 0 }] });
  expect(evidence[0]).toMatchObject({ status: "warn", value: "-21.0 LUFS", target: "-14 LUFS target" });
  expect(evidence[1]).toMatchObject({ status: "pass", value: "0.0 s" });
  expect(JSON.stringify(evidence)).not.toMatch(/secret|private/);
});
it("keeps skipped, malformed and nonfinite readings unverified", () => {
  for (const value of [null, "-14", Infinity, NaN]) expect(reviewQaEvidence({ checks: [{ id: "loudness", status: "pass", integrated_lufs: value }] })[0].status).toBe("unverified");
  expect(reviewQaEvidence({ checks: [{ id: "black", status: "skipped", longest_black_seconds: 0 }] })[1].status).toBe("unverified");
});
const expected = { completedAt: "2026-09-09T00:00:00.000Z", finalPath: "/private/final.mp4", recordingPath: "/private/raw.mp4", audioPath: "/private/audio.wav", recordedAt: "2026-09-08T00:00:00.000Z", scriptDigest: "digest" };
it("projects only current revision-bound measurements", () => {
  const detail = { identity: { version: "tutorial-output-qa/1", ...expected }, checks: [{ id: "black", status: "pass", longest_black_seconds: 0 }] };
  expect(reviewQaEvidence(currentReviewQaDetail(detail, expected))[1].status).toBe("pass");
  expect(currentReviewQaDetail({ checks: detail.checks }, expected)).toBeNull();
});
it.each(Object.keys(expected))("rejects stale QA after changed %s (including rerecording and localized narration)", key => {
  const detail = { identity: { version: "tutorial-output-qa/1", ...expected }, checks: [{ id: "black", status: "pass", longest_black_seconds: 0 }] };
  expect(reviewQaEvidence(currentReviewQaDetail(detail, { ...expected, [key]: "changed" }))[1].status).toBe("unverified");
});
