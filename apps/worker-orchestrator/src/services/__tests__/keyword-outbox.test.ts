import { describe, expect, it } from "vitest";
import { keywordDeliveryFailurePolicy } from "../keyword-outbox";

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
