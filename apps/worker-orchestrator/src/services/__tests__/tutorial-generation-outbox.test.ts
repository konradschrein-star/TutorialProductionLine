import { describe, expect, it } from "vitest";
import { generationDispatchRetrySeconds } from "../tutorial-generation-outbox";

describe("durable tutorial generation dispatch", () => {
  it("uses bounded exponential retry without a zero-delay loop", () => {
    expect(generationDispatchRetrySeconds(1)).toBe(10);
    expect(generationDispatchRetrySeconds(2)).toBe(20);
    expect(generationDispatchRetrySeconds(50)).toBe(300);
  });
});
