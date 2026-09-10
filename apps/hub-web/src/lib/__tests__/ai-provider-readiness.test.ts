import { describe, expect, it } from "vitest";
import { interpretVeoImageReadiness } from "../tutorial/ai-provider-readiness";
describe("image provider readiness", () => {
  it("does not confuse process liveness with generation capacity", () => {
    expect(interpretVeoImageReadiness(200, { ok: true, accounts_healthy: 3 }).ready).toBe(false);
    expect(interpretVeoImageReadiness(503, { ready: true, accounts_capacity: 3 }).ready).toBe(false);
    expect(interpretVeoImageReadiness(200, { ready: true, accounts_capacity: 0 }).ready).toBe(false);
  });
  it("accepts explicit readiness with usable capacity", () => {
    expect(interpretVeoImageReadiness(200, { ready: true, accounts_capacity: 3 }).ready).toBe(true);
  });
  it("never copies arbitrary provider errors or credentials into VA messages", () => {
    expect(JSON.stringify(interpretVeoImageReadiness(503, { error: "secret-token" }))).not.toContain("secret-token");
  });
});
