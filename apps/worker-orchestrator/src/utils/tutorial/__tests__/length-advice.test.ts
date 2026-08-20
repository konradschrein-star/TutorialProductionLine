import { describe, it, expect } from "vitest";
import { parseLengthAdvice, stepCountAdvice } from "../length-advice.js";

/**
 * Only the orchestrator-local half is tested here: parsing the model's answer.
 * The thresholds and the step-count rule moved to @repo/domain (hub-web needs
 * them too and apps must not import from each other) and are tested there.
 *
 * The owner's requirement: "keywords requiring 6 min get 6 min videos but
 * keywords requiring a 2-3 min solution get a 2-3, maybe 4 min video so we
 * don't waste the viewer's time." Both directions are failures — padding a
 * short topic AND compressing a long one into a list of clicks.
 */
describe("parseLengthAdvice", () => {
  it("reads a clean judgement", () => {
    expect(
      parseLengthAdvice(
        '{"minutes": 5.5, "reason": "Twelve steps with two traps."}',
      ),
    ).toEqual({ minutes: 5.5, reason: "Twelve steps with two traps." });
  });

  it("survives the prose models wrap around JSON", () => {
    const r = parseLengthAdvice(
      'Sure!\n```json\n{"minutes": 3, "reason": "Two steps."}\n```\n',
    );
    expect(r?.minutes).toBe(3);
  });

  it("rejects nonsense rather than coercing it", () => {
    expect(parseLengthAdvice("no idea")).toBeNull();
    expect(parseLengthAdvice('{"minutes": 0}')).toBeNull();
    expect(parseLengthAdvice('{"minutes": -4}')).toBeNull();
    expect(parseLengthAdvice('{"minutes": 900}')).toBeNull();
    expect(parseLengthAdvice('{"minutes": "six"}')).toBeNull();
  });
});
