import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), policy: vi.fn(), select: vi.fn() }));
vi.mock("../../utils/thumbnail/index.js", () => ({ requestThumbnail: mocks.request }));
vi.mock("@repo/db/repositories", () => ({ resolveAutopilotPolicy: mocks.policy, selectBestThumbnailForSubject: mocks.select }));
import { createThumbnailProcessor } from "../thumbnail.js";
const payload = { subjectKind: "tutorial_job", subjectId: "11111111-1111-4111-8111-111111111111", channelId: "22222222-2222-4222-8222-222222222222", title: "Drive tutorial", format: "TUTORIAL_STUDIO", language: "en", thumbnailTextTop: "GOOGLE DRIVE", thumbnailTextBottom: "SHARE FILES" };
describe("explicit thumbnail candidates", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue({ status: "completed" }); mocks.policy.mockResolvedValue({ selection_rule: "first_completed" }); mocks.select.mockResolvedValue(undefined); });
  it("does not replace selected or approved images for an explicit candidate", async () => {
    await createThumbnailProcessor({} as never)({ data: { ...payload, manualSelection: true } } as never);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.policy).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled();
  });
  it("never selects a tutorial candidate automatically, even from legacy queue data", async () => {
    await createThumbnailProcessor({} as never)({ data: payload } as never);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("preserves automatic selection for other content formats", async () => {
    await createThumbnailProcessor({} as never)({ data: { ...payload, subjectKind: "content_job" } } as never);
    expect(mocks.select).toHaveBeenCalledWith({}, "content_job", payload.subjectId, "first_completed", "en");
  });
  it.each(["disabled", "cancelled", "rerouted", "delivery", "payload"])("rejects queued tutorial work after %s changes", async (reason) => {
    const data = { ...payload, requestGroupId: "33333333-3333-4333-8333-333333333333", manualSelection: true, variantIndex: 0 };
    const source = { id: payload.subjectId, language: "en", source_job_id: null, channel_id: reason === "rerouted" ? "other" : payload.channelId, status: reason === "cancelled" ? "CANCELLED" : "READY_TO_RECORD" };
    const replies = [[source], [{ thumbnail_generation_mode: reason === "disabled" ? "manual" : "ai" }], [{ ...source, is_uploaded: reason === "delivery" }], [], [{ payload: { payload: {}, count: 5 } }]];
    const tx = { execute: vi.fn(), select: () => ({ from: () => ({ where: () => { const rows = replies.shift(); const result = Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows), limit: () => result }); return result; } }) }) };
    await createThumbnailProcessor({ transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never)({ data } as never);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
