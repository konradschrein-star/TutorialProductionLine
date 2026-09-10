import { describe, expect, it } from "vitest";
import { deliveryStage, summarizeDelivery, uploadStateLabel, type DeliveryStatusInput } from "../delivery-status";

const time = "2026-09-09T12:00:00Z";
const base: DeliveryStatusInput = { uploaderStatus: null, youtubeVisibility: null, scheduledFor: null, isUploaded: false, uploadVerifiedAt: null, youtubePublishedAt: null };
const transferred = { ...base, uploaderStatus: "uploaded", youtubeVisibility: "private", uploadVerifiedAt: time };

describe("delivery presentation evidence boundaries", () => {
  it.each(["private", "unlisted"])("never promotes %s upload plus reservation into publication", visibility => {
    const row = { ...transferred, youtubeVisibility: visibility, scheduledFor: time, isUploaded: true };
    expect(deliveryStage(row)).toBe("transferred");
    expect(uploadStateLabel(row)).toBe(`Uploaded ${visibility} — publication not scheduled`);
  });
  it("counts a verified scheduled-protocol transfer even before isUploaded becomes true", () => {
    expect(deliveryStage(transferred)).toBe("transferred");
  });
  it("does not infer schedule from a reservation or publication from elapsed time", () => {
    expect(deliveryStage({ ...base, scheduledFor: time })).toBe("pending");
    const row = { ...transferred, uploaderStatus: "scheduled", scheduledFor: time };
    expect(deliveryStage(row)).toBe("scheduled");
    expect(uploadStateLabel(row, Date.parse(time) + 1)).toBe("Publication due — awaiting provider verification");
  });
  it("requires verification and exact publication timestamp for published labels", () => {
    expect(deliveryStage({ ...transferred, youtubeVisibility: "public" })).toBe("transferred");
    expect(deliveryStage({ ...transferred, youtubeVisibility: "public", youtubePublishedAt: time })).toBe("published");
    expect(deliveryStage({ ...base, isUploaded: true, youtubeVisibility: "public", youtubePublishedAt: time })).toBe("reported");
  });
  it("keeps manual reports unverified and malformed schedule timestamps non-authoritative", () => {
    expect(deliveryStage({ ...transferred, uploaderStatus: "reported_uploaded" })).toBe("reported");
    expect(uploadStateLabel({ ...base, uploaderStatus: "scheduled", scheduledFor: "invalid" })).toContain("awaiting provider verification");
  });
  it("keeps disjoint page-only totals for each delivery milestone", () => {
    expect(summarizeDelivery([base, transferred, { ...base, isUploaded: true }, { ...transferred, uploaderStatus: "scheduled", scheduledFor: time }, { ...transferred, youtubeVisibility: "public", youtubePublishedAt: time }])).toEqual({ pending: 1, transferred: 1, reported: 1, scheduled: 1, published: 1 });
    expect(summarizeDelivery([])).toEqual({ pending: 0, transferred: 0, reported: 0, scheduled: 0, published: 0 });
  });
});
