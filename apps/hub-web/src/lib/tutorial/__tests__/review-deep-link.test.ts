import { expect, it } from "vitest";
import { reviewQueueUrl, reviewLocaleQueueUrl, selectReviewJob } from "../review-deep-link";
it("never substitutes another visible tutorial for a missing explicit link", () => { expect(selectReviewJob([{ id: "other" }], "other", "linked")).toBeNull(); });
it("honors the exact linked tutorial over an old selected ID", () => { expect(selectReviewJob([{ id: "other" }, { id: "linked" }], "other", "linked")).toEqual({ id: "linked" }); });
it("preserves normal queue fallback without a direct link", () => { expect(selectReviewJob([{ id: "first" }], null, null)).toEqual({ id: "first" }); });
it("sends the requested identity to the API rather than filtering only in memory", () => { expect(reviewQueueUrl(18, false, "linked")).toBe("/api/production/tutorial-review?hours=18&jobId=linked"); expect(reviewQueueUrl(18, true, null)).toBe("/api/production/tutorial-review?hours=18&scope=all"); });
it("preserves an empty explicit ID for API validation and never falls back to the queue", () => { expect(reviewQueueUrl(18, false, "")).toBe("/api/production/tutorial-review?hours=18&jobId="); expect(selectReviewJob([{ id: "first" }], null, "")).toBeNull(); });
it("loads locales using the authorized response scope, including direct Admin links", () => { expect(reviewLocaleQueueUrl("linked", "all")).toBe("/api/production/tutorial-translate?sourceJobId=linked&scope=all"); expect(reviewLocaleQueueUrl("linked", "mine")).toBe("/api/production/tutorial-translate?sourceJobId=linked"); });
