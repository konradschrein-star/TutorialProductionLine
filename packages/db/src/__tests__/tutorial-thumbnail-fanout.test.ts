import { describe, expect, it, vi } from "vitest";
import { englishThumbnailApprovalRevision, recordApprovedEnglishThumbnailFanout, resolveThumbnailFanoutTargets } from "../tutorial-thumbnail-fanout.js";
const input = { sourceJobId: "source", thumbnailId: "english", sourcePath: "/media/english.jpg", sha256: "a".repeat(64), size: 123 };
describe("atomic English approval fanout", () => {
  it("uses exact image bytes and identity in its stable revision", () => {
    expect(englishThumbnailApprovalRevision(input, "channel")).toBe(englishThumbnailApprovalRevision({ ...input }, "channel"));
    expect(englishThumbnailApprovalRevision({ ...input, sha256: "b".repeat(64) }, "channel")).not.toBe(englishThumbnailApprovalRevision(input, "channel"));
    expect(() => englishThumbnailApprovalRevision({ ...input, size: 0 }, "channel")).toThrow();
  });
  it("records independent locale intents only after an explicit selected approval", async () => {
    const primary = "11111111-1111-4111-8111-111111111111", german = "22222222-2222-4222-8222-222222222222", spanish = "33333333-3333-4333-8333-333333333333";
    const source = { id: "source", source_job_id: null, language: "en", channel_id: primary, status: "READY_TO_RECORD" };
    const selected = { id: "english", channel_id: primary, output_path: input.sourcePath, status: "completed", review_verdict: "acceptable" };
    const profile = (language: string, id: string) => ({ id, language, isPrimary: false, enabled: true, metadata: { tutorialChannelProfile: { primaryChannelId: primary, translationEnabled: true } } });
    const replies = [[source], [selected], [{ language: "de", channel_id: german }, { language: "es", channel_id: spanish }], [profile("de", german), profile("es", spanish)]];
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
    const tx = { select: () => ({ from: () => ({ where: () => { const rows = replies.shift(); return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) }); } }) }), insert: () => ({ values }) };
    const result = await recordApprovedEnglishThumbnailFanout(tx as never, { ...input, sourceJobId: "source" });
    expect(result.languages).toEqual(["de","es"]);
    expect(values.mock.calls[0]![0]).toHaveLength(2);
    expect(values.mock.calls[0]![0].every((row: { source_sha256: string }) => row.source_sha256 === input.sha256)).toBe(true);
  });
  it("never invents a locale or falls back to another channel", () => {
    expect(resolveThumbnailFanoutTargets({}, [], [{ id: "spanish", language: "es" }]).targets).toEqual([]);
    const result = resolveThumbnailFanoutTargets({ es: "wrong", Scandinavian: "sv", fr: "missing" }, [], [{ id: "wrong", language: "de" }, { id: "sv", language: "sv" }]);
    expect(result.targets).toEqual([]);
    expect(result.blocked).toEqual(["es", "Scandinavian", "fr"]);
  });
  it("uses a unique authorized child, but rejects conflicting mappings and duplicate children", () => {
    const children = [{ language: "es", channel_id: "spanish" }];
    const destinations = [{ id: "spanish", language: "es" }];
    expect(resolveThumbnailFanoutTargets({}, children, destinations).targets).toEqual([{ language: "es", channelId: "spanish" }]);
    expect(resolveThumbnailFanoutTargets({ es: "another" }, children, destinations).targets).toEqual([]);
    expect(resolveThumbnailFanoutTargets({}, [...children, ...children], destinations).targets).toEqual([]);
  });
});
