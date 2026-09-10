import { describe, expect, it } from "vitest";
import { keywordDeliveryFailurePolicy, keywordReceiptMatches } from "../keyword-outbox";

describe("keyword milestone failure policy", () => {
  it("surfaces identity conflicts for reconciliation without dropping the event", () => {
    expect(keywordDeliveryFailurePolicy(409, 2)).toEqual({
      delaySeconds: 3600,
      message: "Keyword Tool rejected milestone identity; Admin reconciliation required",
    });
  });

  it("backs off deterministic contract and authentication failures", () => {
    expect(keywordDeliveryFailurePolicy(401, 1).delaySeconds).toBe(3600);
    expect(keywordDeliveryFailurePolicy(400, 1).message).toContain("Admin action");
  });

  it("exponentially retries temporary transport failures", () => {
    expect(keywordDeliveryFailurePolicy(undefined, 1).delaySeconds).toBe(10);
    expect(keywordDeliveryFailurePolicy(503, 10).delaySeconds).toBe(3600);
  });
});

describe("keyword milestone receipt identity", () => {
  const v2 = {
    schema_version: 2,
    forge_job_id: "job-1",
    keyword_ref: "42",
    event_sequence: 1,
    dedup_key: "job-1:1",
    external_source: "keyword-tool.omar",
    request_id: "10000000-0000-4000-8000-000000000001",
    production_run_id: "10000000-0000-4000-8000-000000000002",
    opportunity_id: "10000000-0000-4000-8000-000000000003",
    family_id: "10000000-0000-4000-8000-000000000004",
    evidence_id: "10000000-0000-4000-8000-000000000005",
    route_decision_id: "10000000-0000-4000-8000-000000000006",
  };

  it("requires every v2 identity field to be echoed", () => {
    expect(keywordReceiptMatches(v2, { ...v2 })).toBe(true);
    expect(keywordReceiptMatches(v2, { ...v2, production_run_id: "different" })).toBe(false);
    const { request_id: _omitted, ...missingRequest } = v2;
    expect(keywordReceiptMatches(v2, missingRequest)).toBe(false);
  });

  it("keeps the exact legacy receipt contract", () => {
    const legacy = { forge_job_id: "job-1", keyword_ref: "42", event_sequence: 1, dedup_key: "job-1:1" };
    expect(keywordReceiptMatches(legacy, { ...legacy })).toBe(true);
  });
});
