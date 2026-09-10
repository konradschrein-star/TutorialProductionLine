import { expect, it } from "vitest";
import { validateThumbnailQualityReport } from "../quality-report";
const report = { version: 1, sha256: "a".repeat(64), status: "passed", checks: { dimensions: true, nonBlank: true }, issues: [], repairInstructions: null, visualCheck: "checked", approval: "human_required" };
it("accepts only a report matching current image bytes", () => { expect(validateThumbnailQualityReport(report, report.sha256)?.status).toBe("passed"); expect(validateThumbnailQualityReport(report, "b".repeat(64))).toBeNull(); });
it("does not treat absent, malformed, or automatic approval as a pass", () => { for (const value of [null, {}, { ...report, approval: "approved" }]) expect(validateThumbnailQualityReport(value, report.sha256)).toBeNull(); });
