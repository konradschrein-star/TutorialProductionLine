import { describe, expect, it } from "vitest";
import { ScheduledDeliveryReceiptSchema, scheduledDeliveryTransitionAllowed, TutorialDeliveryPolicySchema } from "../tutorial-scheduled-delivery";
const base = { version: "tutorial-scheduled-delivery/1", dispatchId: "2096fe21-44ae-4a2a-9251-573c84b9e85f", claimId: "2096fe21-44ae-4a2a-9251-573c84b9e850", approvalRevision: "a".repeat(64), requestSha256: "b".repeat(64), sequence: 1, state: "uploaded", occurredAt: "2026-09-08T12:00:00Z", message: "Provider checked", videoId: "abcdefghijk", visibility: "private", evidence: { kind: "provider_readback", reference: "provider/video/abcdefghijk", observedAt: "2026-09-08T12:00:00Z" } };
describe("optional scheduled delivery", () => {
  it("defaults to manual and does not infer audience/monetization", () => { expect(TutorialDeliveryPolicySchema.parse({}).mode).toBe("manual"); expect(TutorialDeliveryPolicySchema.safeParse({ mode: "scheduled_automatic" }).success).toBe(false); });
  it("requires ad suitability only when automatic monetization is on", () => { expect(TutorialDeliveryPolicySchema.safeParse({ mode: "scheduled_automatic", notMadeForKidsConfirmed: true, monetization: "on" }).success).toBe(false); expect(TutorialDeliveryPolicySchema.safeParse({ mode: "scheduled_automatic", notMadeForKidsConfirmed: true, monetization: "off" }).success).toBe(true); });
  it("requires exact revision and request digests", () => { expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, approvalRevision: undefined }).success).toBe(false); });
  it("requires provider readback for verified upload", () => { expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, evidence: undefined }).success).toBe(false); });
  it("accepts a private upload without claiming publication", () => { expect(ScheduledDeliveryReceiptSchema.safeParse(base).success).toBe(true); });
  it("requires confirmed publish time for scheduled", () => { expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, state: "scheduled" }).success).toBe(false); });
  it("requires private visibility until scheduled time", () => { expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, state: "scheduled", scheduledFor: "2026-09-09T12:00:00Z", visibility: "public" }).success).toBe(false); });
  it("requires public evidence and publication date", () => { expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, state: "published" }).success).toBe(false); expect(ScheduledDeliveryReceiptSchema.safeParse({ ...base, state: "published", visibility: "public", publishedAt: base.occurredAt }).success).toBe(true); });
  it.each(["uploaded", "scheduled", "published"] as const)("reconciles uncertain with %s evidence", next => { expect(scheduledDeliveryTransitionAllowed("generic_uncertain", next)).toBe(true); });
  it("does not restart uncertain uploads", () => { expect(scheduledDeliveryTransitionAllowed("generic_uncertain", "uploading")).toBe(false); });
  it("does not regress verified publication", () => { expect(scheduledDeliveryTransitionAllowed("generic_published", "failed")).toBe(false); });
  it("does not accept receipts before claim", () => { expect(scheduledDeliveryTransitionAllowed("generic_queued", "published")).toBe(false); });
});
